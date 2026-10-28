from datetime import timedelta
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from api.app import app
from api.database import Base, get_db
from api.auth_dependency import current_user
from api.models import User, utc_now
from api.reliability_models import ServiceEvent
from api.monitoring import record_job, job_status


@pytest.fixture
def monitor(monkeypatch):
    engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    old = app.dependency_overrides.copy()
    monkeypatch.setattr(app.state, 'storage_ready', True, raising=False)
    with Session(engine) as db:
        user = User(username='Monitor', email='monitor@test.invalid', password_hash='unused')
        db.add(user); db.commit()
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[current_user] = lambda: user
        monkeypatch.delenv('CRON_SECRET', raising=False)
        monkeypatch.setenv('SCHEDULE_RUNNER_SECRET', 'test-runner')
        try:
            client = TestClient(app)
            yield client, db
            client.close()
        finally:
            app.dependency_overrides = old
    engine.dispose()


def test_runner_records_empty_runs_and_readiness_goes_stale(monitor, monkeypatch):
    client, db = monitor
    monkeypatch.setattr('api.update_push.dispatch_scheduled', lambda db: {'sent': 0})
    assert client.get('/api/health/ready').status_code == 503
    assert client.post('/api/maintenance/scheduled-transactions', headers={'Authorization':'Bearer test-runner'}).status_code == 200
    assert client.get('/api/health/ready').json() == {'ok': True}
    row = db.query(ServiceEvent).filter_by(area='scheduler-heartbeat').one()
    row.created_at = utc_now() - timedelta(minutes=6); db.commit()
    assert client.get('/api/health/ready').status_code == 503
    assert job_status(db)['scheduler']['healthy'] is False


def test_failed_runner_and_private_client_signals(monitor, monkeypatch):
    client, db = monitor
    def fail(db):
        raise RuntimeError('secret-private-payload')
    monkeypatch.setattr('api.planned.post_due', fail)
    response = client.post('/api/maintenance/scheduled-transactions', headers={'Authorization':'Bearer test-runner'})
    assert response.status_code == 503
    assert 'secret-private-payload' not in response.text
    assert job_status(db)['scheduler']['healthy'] is False
    assert client.post('/api/diagnostics/client-error', json={'code':'render','version':'6.2.1','page':'/settings','stack':'secret'}).status_code == 422
    assert client.post('/api/diagnostics/client-error', json={'code':'render','version':'6.2.1','page':'/settings'}).status_code == 204
    assert db.query(ServiceEvent).filter(ServiceEvent.area.like('client:%')).count() == 1


def test_heartbeat_is_bounded(monitor):
    _, db = monitor
    for _ in range(20):
        record_job(db, 'scheduler-heartbeat', 200)
    assert db.query(ServiceEvent).filter_by(area='scheduler-heartbeat').count() == 1


def test_diagnostics_require_auth_and_readiness_exposes_no_details(monitor):
    client, db = monitor
    assert client.get('/api/health/ready').json() == {'ok': False}
    app.dependency_overrides.pop(current_user)
    assert client.post('/api/diagnostics/client-error', json={'code':'render','version':'6.2.1'}).status_code == 401
    assert db.query(ServiceEvent).filter(ServiceEvent.area.like('client:%')).count() == 0


def test_external_backup_failure_and_partial_config_fail_readiness(monitor, monkeypatch):
    client, db = monitor
    record_job(db, 'scheduler-heartbeat', 200)
    keys = ('BACKUP_S3_BUCKET', 'BACKUP_S3_REGION', 'BACKUP_S3_ACCESS_KEY_ID',
            'BACKUP_S3_SECRET_ACCESS_KEY', 'BACKUP_ENCRYPTION_KEY')
    for key in keys: monkeypatch.delenv(key, raising=False)
    assert client.get('/api/health/ready').status_code == 200
    monkeypatch.setenv(keys[0], 'synthetic')
    assert client.get('/api/health/ready').status_code == 503
    for key in keys: monkeypatch.setenv(key, 'synthetic')
    record_job(db, 'external-backup', 200)
    assert client.get('/api/health/ready').status_code == 200
    record_job(db, 'external-backup', 500)
    assert client.get('/api/health/ready').json() == {'ok':False}
    record_job(db, 'external-backup', 200)
    row = db.query(ServiceEvent).filter_by(area='external-backup').one()
    row.created_at = utc_now() - timedelta(hours=37); db.commit()
    assert client.get('/api/health/ready').status_code == 503

@pytest.mark.parametrize('area,secret,name', [
    ('scheduler-heartbeat', 'SCHEDULE_RUNNER_SECRET', 'scheduler'),
    ('daily-recovery', 'CRON_SECRET', 'daily_backup'),
    ('external-backup', 'BACKUP_S3_BUCKET', 'external_backup'),
])
def test_future_job_success_is_not_healthy(monitor, monkeypatch, area, secret, name):
    _, db = monitor
    monkeypatch.setattr('api.monitoring.resource_control.configured', lambda: False)
    monkeypatch.setenv(secret, 'synthetic')
    if name == 'external_backup':
        for key in ('BACKUP_S3_REGION', 'BACKUP_S3_ACCESS_KEY_ID',
                    'BACKUP_S3_SECRET_ACCESS_KEY', 'BACKUP_ENCRYPTION_KEY'):
            monkeypatch.setenv(key, 'synthetic')
    db.add(ServiceEvent(area=area, status=200, created_at=utc_now() + timedelta(hours=1)))
    db.commit()
    assert job_status(db)[name]['healthy'] is False


@pytest.mark.parametrize('area,secret,name', [
    ('scheduler-heartbeat', 'SCHEDULE_RUNNER_SECRET', 'scheduler'),
    ('daily-recovery', 'CRON_SECRET', 'daily_backup'),
])
def test_latest_failure_wins_timestamp_tie(monitor, monkeypatch, area, secret, name):
    _, db = monitor
    monkeypatch.setattr('api.monitoring.resource_control.configured', lambda: False)
    monkeypatch.setenv(secret, 'synthetic')
    stamp = utc_now()
    db.add(ServiceEvent(area=area, status=200, created_at=stamp))
    db.flush()
    failure = ServiceEvent(area=area, status=503, created_at=stamp)
    db.add(failure)
    db.commit()
    assert job_status(db)[name]['healthy'] is False
    record_job(db, area, 200)
    db.refresh(failure)
    assert failure.status == 200
