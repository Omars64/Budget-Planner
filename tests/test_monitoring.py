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
