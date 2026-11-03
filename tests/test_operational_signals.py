from datetime import timedelta
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from api.database import Base
from api.models import utc_now
from api.reliability_models import ServiceEvent
from api.operational_signals import operational_signals


@pytest.fixture
def signal_db():
    engine = create_engine('sqlite://')
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        yield db
    engine.dispose()


def test_repeated_financial_errors_are_reported_without_private_details(signal_db):
    db = signal_db
    now = utc_now()
    db.add_all([ServiceEvent(area='/api/transactions/{transaction_id}', status=503, created_at=now),
                ServiceEvent(area='/api/shared/transactions', status=500, created_at=now),
                ServiceEvent(area='/api/wallets', status=503, created_at=now)])
    db.flush()
    result = operational_signals(db, now=now)
    assert result == {'window_minutes': 15, 'failed_financial_requests': 3,
                      'client_errors': 0, 'slow_requests': 0,
                      'failed_request_threshold': 3, 'healthy': False}
    # A time-bounded alert clears without deleting historical evidence.
    assert operational_signals(db, now=now + timedelta(minutes=16))['healthy'] is True
    assert db.query(ServiceEvent).count() == 3


def test_validation_other_routes_and_future_events_are_not_financial_outages(signal_db):
    db = signal_db
    now = utc_now()
    db.add_all([ServiceEvent(area='/api/transactions', status=409, created_at=now),
                ServiceEvent(area='/api/transactions', status=403, created_at=now),
                ServiceEvent(area='/api/transactions', status=503, created_at=now + timedelta(seconds=1)),
                ServiceEvent(area='/api/transactions', status=503, created_at=now - timedelta(minutes=16)),
                ServiceEvent(area='/api/ai/chat', status=503, duration_ms=2200, created_at=now),
                ServiceEvent(area='client:render:6.12.3:/settings', status=500, created_at=now)])
    db.flush()
    result = operational_signals(db, now=now)
    assert result['healthy'] is True
    assert result['failed_financial_requests'] == 0
    assert result['client_errors'] == 1
    assert result['slow_requests'] == 1


def test_no_events_is_healthy_without_changing_records(signal_db):
    assert operational_signals(signal_db)['healthy'] is True
    assert not signal_db.new


def test_readiness_detects_repeated_financial_failures_without_exposing_counts(signal_db, monkeypatch):
    import json
    from api import diagnostics
    monkeypatch.setattr(diagnostics, 'IS_EPHEMERAL_VERCEL_SQLITE', False)
    monkeypatch.setattr(diagnostics, 'job_status', lambda db: {})
    assert json.loads(diagnostics.readiness(signal_db).body) == {'ok': True}
    signal_db.add_all([ServiceEvent(area='/api/transactions', status=503) for _ in range(3)])
    signal_db.flush()
    response = diagnostics.readiness(signal_db)
    assert response.status_code == 503
    assert json.loads(response.body) == {'ok': False}
    assert response.headers['cache-control'] == 'no-store'
