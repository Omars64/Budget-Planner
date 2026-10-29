"""Policy enforcement against synthetic storage and mocked outbound providers."""
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import Mock
import json
import httpx
import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from api import ai_settings, ai_provider, resource_control, update_push, upcoming_reminders
from api.reliability_models import RateBucket


def policy(monkeypatch, **values):
    monkeypatch.setattr(resource_control, 'read_state', lambda: {'policy': values})


def test_defaults_and_bounds(monkeypatch):
    policy(monkeypatch)
    assert ai_settings.operational_policy()['ai_user_daily_requests'] == 50
    policy(monkeypatch, ai_max_output_tokens=99999, notification_batch_size=0)
    assert ai_settings.operational_policy()['ai_max_output_tokens'] == 1800
    assert ai_settings.operational_policy()['notification_batch_size'] == 1


@pytest.mark.parametrize('key', ['ai_global_daily_requests', 'ai_user_daily_requests'])
def test_zero_daily_never_reserves(monkeypatch, key):
    policy(monkeypatch, **{key: 0})
    db = Mock()
    with pytest.raises(HTTPException) as error:
        ai_settings.reserve_ai(db, 3)
    assert error.value.status_code == 429
    assert not db.mock_calls


def test_global_limit_concurrent_and_user_id_scope(monkeypatch, tmp_path):
    policy(monkeypatch, ai_global_daily_requests=4, ai_global_minute_requests=60,
           ai_user_daily_requests=2)
    engine = create_engine('sqlite:///' + str(tmp_path / 'limits.db'), connect_args={'timeout': 20})
    RateBucket.__table__.create(engine)
    def reserve(user_id):
        with Session(engine) as db:
            try:
                ai_settings.reserve_ai(db, user_id)
                return True
            except HTTPException as error:
                assert error.status_code == 429
                return False
    assert reserve(1)
    assert reserve(1)
    assert not reserve(1)
    assert reserve(2)
    with ThreadPoolExecutor(max_workers=8) as pool:
        assert not any(pool.map(reserve, range(10, 26)))
    engine.dispose()


def test_new_global_ceiling_under_concurrent_first_insert(monkeypatch, tmp_path):
    policy(monkeypatch, ai_global_daily_requests=3, ai_global_minute_requests=60)
    engine = create_engine('sqlite:///' + str(tmp_path / 'race.db'), connect_args={'timeout': 20})
    RateBucket.__table__.create(engine)
    def reserve(user_id):
        with Session(engine) as db:
            try:
                ai_settings.reserve_ai(db, user_id)
                return 1
            except HTTPException:
                return 0
    with ThreadPoolExecutor(max_workers=8) as pool:
        assert sum(pool.map(reserve, range(20))) == 3
    engine.dispose()


@pytest.mark.parametrize('path', ['complete', 'complete_draft', 'check_connection'])
def test_output_caps_and_metric_outage(monkeypatch, path):
    policy(monkeypatch, ai_max_output_tokens=128)
    monkeypatch.setenv('OPENAI_API_KEY', 'synthetic')
    recorder = Mock(side_effect=RuntimeError('metrics unavailable'))
    monkeypatch.setattr(resource_control, 'record_metric', recorder, raising=False)
    real_client = httpx.Client
    def handle(request):
        payload = json.loads(request.content)
        assert payload['model'] == 'gpt-4o-mini'
        assert payload['max_completion_tokens'] == (8 if path == 'check_connection' else 128)
        return httpx.Response(200, json={'choices': [{'message': {'content': '{}'}}],
                                       'usage': {'prompt_tokens': 7, 'completion_tokens': 2}})
    monkeypatch.setattr(ai_provider.httpx, 'Client', lambda **kw: real_client(transport=httpx.MockTransport(handle), **kw))
    args = {'complete': ({}, 'question', [], 'guide'), 'complete_draft': ({}, 'question'), 'check_connection': ()}
    assert getattr(ai_provider, path)(*args[path])
    assert ('ai_attempts', 1) in [call.args for call in recorder.call_args_list]
    assert ('ai_successes', 1) in [call.args for call in recorder.call_args_list]


@pytest.mark.parametrize('key,dispatch', [
    ('release_notifications_enabled', update_push.dispatch_updates),
    ('scheduled_notifications_enabled', update_push.dispatch_scheduled),
    ('upcoming_notifications_enabled', upcoming_reminders.dispatch_upcoming),
])
def test_paused_notifications_preserve_pending_work(monkeypatch, key, dispatch):
    policy(monkeypatch, **{key: False})
    sender = Mock()
    monkeypatch.setattr(update_push, 'send_device', sender)
    db = Mock()
    assert dispatch(db)['sent'] == 0
    sender.assert_not_called()
    assert not db.mock_calls


from tests.test_ask_budgetly import setup, create
from tests.test_update_push import workspace, payload
from tests.test_upcoming_reminders import setup_plan
from api.ai_models import AssistantConfig
from api import ai_service


@pytest.mark.parametrize('outage', [False, True])
@pytest.mark.parametrize('question', ['Explain budgeting', 'Add expense 5 for food'])
def test_zero_quota_preserves_builtin_chat_and_extraction(setup, monkeypatch, question, outage):
    client, db, user, provider = setup
    policy(monkeypatch, ai_global_daily_requests=0)
    if outage:
        monkeypatch.setattr(resource_control, 'read_state', lambda: {
            'policy': {}, 'coordination': {'configured': True, 'healthy': False}})
    db.add(AssistantConfig(id=1, enabled=True)); db.commit()
    extractor = Mock()
    monkeypatch.setattr(ai_service, 'complete_draft', extractor)
    chat = create(client)
    import uuid
    response = client.post(f'/api/ai/chats/{chat}/messages', json={
        'request_id': str(uuid.uuid4()), 'question': question})
    assert response.status_code == 200
    assert response.json()['provider'] == 'built-in'
    provider.assert_not_called()
    extractor.assert_not_called()
    probe = Mock()
    monkeypatch.setattr(ai_provider, 'check_connection', probe)
    assert client.post('/api/admin/assistant/check').json()['reason'] == 'rate_limit'
    probe.assert_not_called()


def test_release_batch_resumes_without_duplicates(workspace, monkeypatch):
    client, db, user = workspace
    policy(monkeypatch, notification_batch_size=1)
    for _ in range(3):
        assert client.put('/api/app-updates/push-device', json=payload()).status_code == 200
    sender = Mock(return_value=200)
    monkeypatch.setattr(update_push, 'send_device', sender)
    for _ in range(3):
        assert update_push.dispatch_updates(db)['sent'] == (3 if _ == 0 else 0)
    assert update_push.dispatch_updates(db)['sent'] == 0
    assert sender.call_count == 3


def test_upcoming_pause_then_resume_deduplicates(workspace, monkeypatch):
    client, db, user = workspace
    setup_plan(client, db, user, monkeypatch)
    sender = Mock(return_value=200)
    monkeypatch.setattr(update_push, 'send_device', sender)
    policy(monkeypatch, upcoming_notifications_enabled=False)
    assert upcoming_reminders.dispatch_upcoming(db)['sent'] == 0
    assert db.query(update_push.UpcomingPushReceipt).count() == 0
    policy(monkeypatch, notification_batch_size=1)
    assert upcoming_reminders.dispatch_upcoming(db)['sent'] == 1
    assert upcoming_reminders.dispatch_upcoming(db)['sent'] == 0
    sender.assert_called_once()



def test_scheduled_pause_preserves_outbox_then_resumes(workspace, monkeypatch):
    client, db, user = workspace
    body, wallet, plan = setup_plan(client, db, user, monkeypatch)
    body['scheduled'] = True
    client.put('/api/app-updates/push-device', json=body)
    plan.status = 'posted'
    update_push.queue_scheduled(db, plan)
    db.commit()
    sender = Mock(return_value=200)
    monkeypatch.setattr(update_push, 'send_device', sender)
    policy(monkeypatch, scheduled_notifications_enabled=False)
    assert update_push.dispatch_scheduled(db)['sent'] == 0
    event = db.query(update_push.ScheduledPush).one()
    assert event.sent_at is None
    policy(monkeypatch, notification_batch_size=1)
    assert update_push.dispatch_scheduled(db)['sent'] == 1
    assert update_push.dispatch_scheduled(db)['sent'] == 0
    sender.assert_called_once()



def test_configured_store_outage_fails_closed(monkeypatch):
    monkeypatch.setattr(resource_control, 'read_state', lambda: {
        'policy': {}, 'coordination': {'configured': True, 'healthy': False}})
    settings = ai_settings.operational_policy()
    assert settings['ai_global_daily_requests'] == 0
    assert not settings['release_notifications_enabled']
    assert not settings['scheduled_notifications_enabled']
    assert not settings['upcoming_notifications_enabled']
    db = Mock()
    with pytest.raises(HTTPException):
        ai_settings.reserve_ai(db, 1)
    assert not db.mock_calls
    for dispatch in (update_push.dispatch_updates, update_push.dispatch_scheduled, upcoming_reminders.dispatch_upcoming):
        assert dispatch(db)['sent'] == 0
    assert not db.mock_calls


def test_request_snapshot_is_scoped_and_avoids_repeated_reads(monkeypatch):
    read = Mock(return_value={'policy': {}})
    monkeypatch.setattr(resource_control, 'read_state', read)
    snapshot = ai_settings.operational_policy()
    with ai_settings.policy_snapshot(snapshot):
        assert ai_settings.operational_policy() is snapshot
        assert ai_settings.operational_policy() is snapshot
    assert read.call_count == 1
    ai_settings.operational_policy()
    assert read.call_count == 2



def test_release_fetch_chunks_preserve_both_platform_budgets(workspace, monkeypatch):
    from api import app_updates
    from uuid import uuid4
    client, db, user = workspace
    policy(monkeypatch, notification_batch_size=1)
    monkeypatch.setenv('FIREBASE_SERVICE_ACCOUNT_JSON', '{}')
    monkeypatch.setattr(app_updates, 'load_release', lambda: {'version': update_push.VERSION})
    for platform in ('browser', 'android'):
        for _ in range(12):
            db.add(update_push.UpdatePushDevice(id=str(uuid4()), user_id=user.id,
                platform=platform, installed_version='0.0.1',
                payload=update_push.cipher().encrypt(json.dumps({'credentials': 'synthetic', 'updates': True}).encode()).decode()))
    db.commit()
    delivered = []
    monkeypatch.setattr(update_push, 'send_device', lambda row, version: delivered.append(row.platform) or 200)
    assert update_push.dispatch_updates(db)['sent'] == 20
    assert delivered.count('browser') == delivered.count('android') == 10
    assert update_push.dispatch_updates(db)['sent'] == 4
    assert update_push.dispatch_updates(db)['sent'] == 0
