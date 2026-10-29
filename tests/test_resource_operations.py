"""Resource scheduler integration with mocked storage and providers only."""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import HTTPException, Request

from api import monitoring, operations, planned, resource_control, resource_schedule
from api import upcoming_reminders, update_push
from api.reliability_models import ServiceEvent


NOW = datetime(2026, 10, 23, 9, tzinfo=timezone.utc)


@pytest.fixture
def scheduler(monkeypatch):
    monkeypatch.setenv('SCHEDULE_RUNNER_SECRET', 'synthetic-runner')
    request = Request({'type': 'http', 'headers': [
        (b'authorization', b'Bearer synthetic-runner')]})
    request.state.resource_claim = {'action': 'run', 'token': 'synthetic', 'generation': 'test'}
    db = Mock()
    db.query.return_value.filter.return_value.first.return_value = None
    post = Mock(return_value=0)
    delivery = Mock(return_value={'sent': 0, 'failed': 0})
    upcoming = Mock(return_value={'sent': 0, 'failed': 0})
    wake = Mock(return_value=NOW + timedelta(hours=1))
    record = Mock()

    class Clock:
        @staticmethod
        def now(zone):
            assert zone is timezone.utc
            return NOW

    monkeypatch.setattr(operations, 'datetime', Clock)
    monkeypatch.setattr(planned, 'post_due', post)
    monkeypatch.setattr(update_push, 'dispatch_scheduled', delivery)
    monkeypatch.setattr(upcoming_reminders, 'dispatch_upcoming', upcoming)
    monkeypatch.setattr(resource_schedule, 'next_scheduler_wake', wake)
    monkeypatch.setattr(monitoring, 'record_job', record)
    return SimpleNamespace(request=request, db=db, post=post, delivery=delivery,
                           upcoming=upcoming, wake=wake, record=record)


@pytest.mark.parametrize('idle', [False, True])
def test_claimed_scheduler_publishes_wake_after_processing(scheduler, idle):
    s = scheduler
    events = []
    s.post.side_effect = lambda db: events.append('post') or 0
    s.delivery.side_effect = lambda db: events.append('delivery') or {'failed': 0}
    s.upcoming.side_effect = lambda db: events.append('upcoming') or {'failed': 0}

    def wake(db, now):
        assert db is s.db
        assert now == NOW
        assert s.request.state.resource_scheduler_success is False
        events.append('wake')
        return None if idle else NOW + timedelta(hours=1)

    s.wake.side_effect = wake
    result = operations.scheduled_transactions(s.request, s.db)
    assert events == ['post', 'delivery', 'upcoming', 'wake']
    assert result == {'ok': True, 'scheduled_transactions_posted': 0,
                      'notifications': {'failed': 0}, 'upcoming_notifications': {'failed': 0}}
    assert s.request.state.resource_next_epoch == (None if idle else (NOW + timedelta(hours=1)).timestamp())
    assert s.request.state.resource_scheduler_success is True
    s.record.assert_called_once_with(s.db, 'scheduler-heartbeat', 200)


@pytest.mark.parametrize('target', ['delivery', 'upcoming'])
@pytest.mark.parametrize('raises', [False, True])
def test_delivery_failures_prevent_coordinator_success(scheduler, target, raises):
    s = scheduler
    dispatch = getattr(s, target)
    if raises:
        dispatch.side_effect = RuntimeError('Synthetic provider failure')
    else:
        dispatch.return_value = {'sent': 0, 'failed': 2}
    result = operations.scheduled_transactions(s.request, s.db)
    assert result['ok'] is True
    assert s.request.state.resource_scheduler_success is False
    assert s.request.state.resource_next_epoch == s.wake.return_value.timestamp()
    s.wake.assert_called_once_with(s.db, NOW)
    s.delivery.assert_called_once_with(s.db)
    s.upcoming.assert_called_once_with(s.db)
    assert s.db.rollback.call_count == int(raises)


@pytest.mark.parametrize('claim', [None, {'action': 'fallback'}, {'action': 'skip'}, {'action': 'busy'}])
def test_unclaimed_scheduler_keeps_legacy_processing(scheduler, claim):
    s = scheduler
    if claim is None:
        del s.request.state.resource_claim
    else:
        s.request.state.resource_claim = claim
    result = operations.scheduled_transactions(s.request, s.db)
    assert result['ok'] is True
    s.post.assert_called_once_with(s.db)
    s.delivery.assert_called_once_with(s.db)
    s.upcoming.assert_called_once_with(s.db)
    s.wake.assert_not_called()
    assert not hasattr(s.request.state, 'resource_next_epoch')
    assert not hasattr(s.request.state, 'resource_scheduler_success')


def test_posting_batches_and_commits_are_preserved(scheduler):
    s = scheduler
    s.post.side_effect = [3, 2]
    s.db.query.return_value.filter.return_value.first.side_effect = [object(), None]
    result = operations.scheduled_transactions(s.request, s.db)
    assert result['scheduled_transactions_posted'] == 5
    assert s.post.call_count == 2
    s.db.commit.assert_called_once()
    event = s.db.add.call_args.args[0]
    assert event.area == 'scheduled-transactions'
    assert event.status == 200
    assert s.request.state.resource_scheduler_success is True


def test_posting_failure_remains_unsuccessful_and_does_not_publish(scheduler):
    s = scheduler
    s.post.side_effect = RuntimeError('Synthetic posting failure')
    with pytest.raises(HTTPException) as failure:
        operations.scheduled_transactions(s.request, s.db)
    assert failure.value.status_code == 503
    assert s.request.state.resource_scheduler_success is False
    s.db.rollback.assert_called_once()
    s.record.assert_called_once_with(s.db, 'scheduler-heartbeat', 503)
    s.delivery.assert_not_called()
    s.upcoming.assert_not_called()
    s.wake.assert_not_called()


def test_scheduler_authorization_precedes_processing(scheduler):
    s = scheduler
    request = Request({'type': 'http', 'headers': []})
    with pytest.raises(HTTPException) as failure:
        operations.scheduled_transactions(request, s.db)
    assert failure.value.status_code == 401
    s.post.assert_not_called()
    s.wake.assert_not_called()


@pytest.fixture
def status(monkeypatch):
    for key in ('SCHEDULE_RUNNER_SECRET', 'CRON_SECRET', 'BACKUP_S3_BUCKET',
                'BACKUP_S3_REGION', 'BACKUP_S3_ACCESS_KEY_ID',
                'BACKUP_S3_SECRET_ACCESS_KEY', 'BACKUP_ENCRYPTION_KEY'):
        monkeypatch.setenv(key, 'synthetic')
    monkeypatch.setattr(monitoring, 'utc_now', lambda: NOW.replace(tzinfo=None))
    monkeypatch.setattr(monitoring, 'ledger_now', lambda: NOW.replace(tzinfo=None))
    rows = {area: SimpleNamespace(status=200, created_at=NOW.replace(tzinfo=None))
            for area in ('scheduler-heartbeat', 'daily-recovery', 'external-backup')}
    overdue = Mock()
    overdue.filter.return_value.count.return_value = 0
    db = Mock()

    def query(model):
        if model is ServiceEvent:
            result = Mock()
            result.filter_by.side_effect = lambda *, area: SimpleNamespace(
                order_by=lambda *args: SimpleNamespace(first=lambda: rows.get(area)))
            return result
        return overdue

    db.query.side_effect = query
    configured = Mock(return_value=True)
    read = Mock(return_value={'policy': dict(resource_control.DEFAULT_POLICY),
                             'coordination': {'healthy': True}, 'status': {
        'last_tick': NOW.timestamp(), 'last_run': NOW.timestamp() - 3600}})
    monkeypatch.setattr(resource_control, 'configured', configured)
    monkeypatch.setattr(resource_control, 'read_state', read)
    return SimpleNamespace(db=db, rows=rows, overdue=overdue, configured=configured, read=read)


@pytest.mark.parametrize('age,failure,success,healthy', [
    (-1, None, None, False), (-0.001, None, None, False),
    (0, None, None, True), (300, None, None, True), (301, None, None, False),
    (0, -10, None, False), (0, -10, -20, False),
    (0, -10, -10, True), (0, -20, -10, True),
])
def test_external_ticks_and_failures_determine_scheduler_health(status, age, failure, success, healthy):
    s = status
    external = s.read.return_value['status']
    external['last_tick'] = NOW.timestamp() - age
    if failure is not None:
        external['last_failure'] = NOW.timestamp() + failure
    if success is not None:
        external['last_success'] = NOW.timestamp() + success
    # An idle external tick can be healthy even with an old SQL heartbeat.
    s.rows['scheduler-heartbeat'].created_at -= timedelta(days=1)
    result = monitoring.job_status(s.db)
    assert result['scheduler']['healthy'] is healthy
    assert result['scheduler']['last_run'] == '2026-10-23T08:00:00Z'
    assert result['daily_backup']['healthy'] is True
    assert result['external_backup']['healthy'] is True
    s.overdue.filter.return_value.count.assert_called_once()


@pytest.mark.parametrize('provider', ['unhealthy', 'exception', 'missing_tick'])
def test_coordinator_failure_is_visible_despite_healthy_sql_heartbeat(status, provider):
    s = status
    if provider == 'unhealthy':
        s.read.return_value['coordination']['healthy'] = False
    elif provider == 'exception':
        s.read.side_effect = RuntimeError('Synthetic provider outage')
    else:
        s.read.return_value['status'].pop('last_tick')
    result = monitoring.job_status(s.db)
    assert result['scheduler']['configured'] is True
    assert result['scheduler']['healthy'] is False
    assert result['daily_backup']['healthy'] is True
    assert result['external_backup']['healthy'] is True


def test_overdue_work_and_backup_failures_still_veto_health(status):
    s = status
    s.overdue.filter.return_value.count.return_value = 2
    s.rows['daily-recovery'].status = 503
    s.rows['external-backup'].status = 500
    result = monitoring.job_status(s.db)
    assert result['scheduler']['overdue_count'] == 2
    assert result['scheduler']['healthy'] is False
    assert result['daily_backup']['healthy'] is False
    assert result['external_backup']['healthy'] is False


@pytest.mark.parametrize('configured,age,event_status,healthy', [
    (True, 0, 200, True), (True, 301, 200, False),
    (True, 0, 503, False), (False, 0, 200, None),
])
def test_unconfigured_coordination_preserves_legacy_status(status, monkeypatch, configured, age, event_status, healthy):
    s = status
    s.configured.return_value = False
    if not configured:
        monkeypatch.delenv('SCHEDULE_RUNNER_SECRET')
    row = s.rows['scheduler-heartbeat']
    row.created_at -= timedelta(seconds=age)
    row.status = event_status
    result = monitoring.job_status(s.db)
    assert result['scheduler']['configured'] is configured
    assert result['scheduler']['healthy'] is healthy
    assert result['scheduler']['last_run'] == row.created_at.isoformat() + 'Z'
    s.read.assert_not_called()


@pytest.mark.parametrize('provider', ['healthy', 'unhealthy', 'exception'])
@pytest.mark.parametrize('overdue', [0, 2])
def test_missing_runner_secret_preserves_unknown_health_with_coordination(status, monkeypatch, provider, overdue):
    s = status
    monkeypatch.delenv('SCHEDULE_RUNNER_SECRET')
    s.overdue.filter.return_value.count.return_value = overdue
    if provider == 'unhealthy':
        s.read.return_value['coordination']['healthy'] = False
    elif provider == 'exception':
        s.read.side_effect = RuntimeError('Synthetic provider outage')

    result = monitoring.job_status(s.db)

    assert result['scheduler'] == {
        'configured': False, 'healthy': None,
        'last_run': s.rows['scheduler-heartbeat'].created_at.isoformat() + 'Z',
        'overdue_count': overdue, 'paused': False, 'interval_minutes': 1,
    }
    assert result['daily_backup']['healthy'] is True
    assert result['external_backup']['healthy'] is True
    s.read.assert_not_called()
