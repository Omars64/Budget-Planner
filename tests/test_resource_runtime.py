"""Runtime fences and entrypoint integration; all storage/providers are synthetic."""
import asyncio
import hashlib
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from importlib import import_module
from types import SimpleNamespace
from unittest.mock import ANY, Mock

import httpx
import fakeredis
import pytest
from fastapi import Depends, FastAPI, Request
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from api import database, index, planned, resource_runtime as runtime, service_events
from api.models import PlannedTransaction, Transaction, User, Wallet, utc_now
from api.reliability_models import AccountSession


POLICY = dict(client_poll_seconds=60, idle_recheck_minutes=180,
              database_probe_minutes=60)
STATE = dict(policy=POLICY, revision='synthetic-revision',
             coordination=dict(configured=True, healthy=True), status={})
ORIGIN = 'http://localhost:5173'


@pytest.fixture(autouse=True)
def isolated(monkeypatch):
    """Conftest selects temporary SQLite; fail if these tests touch it or HTTP."""
    forbidden = Mock(side_effect=AssertionError('Unexpected storage/network access'))
    monkeypatch.setattr(database.engine, 'connect', forbidden)
    monkeypatch.setattr(database, 'SessionLocal', forbidden)
    monkeypatch.setattr(index, 'SessionLocal', forbidden)
    monkeypatch.setattr(httpx.HTTPTransport, 'handle_request', forbidden)
    monkeypatch.setattr(httpx.AsyncHTTPTransport, 'handle_async_request', forbidden)
    monkeypatch.setenv('SCHEDULE_RUNNER_SECRET', 'synthetic-runner')
    mocks = {}
    for name, value in dict(configured=True, read_state=STATE,
                            read_health={'cached': True, 'ok': True},
                            claim_scheduler={'action': 'skip'}, begin_change='token',
                            end_change=None, finish_scheduler=None, save_health=None,
                            update_policy=STATE).items():
        mocks[name] = Mock(return_value=value)
        monkeypatch.setattr(runtime.control, name, mocks[name])
    monkeypatch.setattr(service_events, 'record_event', Mock())
    return SimpleNamespace(**mocks, forbidden=forbidden)


@pytest.fixture
def integration(monkeypatch, isolated):
    application = import_module('api.app').app
    assert application is index.app
    previous = dict(application.dependency_overrides)
    events = []
    db = Mock()

    def get_db():
        events.append('dependency')
        try:
            yield db
        finally:
            events.append('teardown')

    application.dependency_overrides[database.get_db] = get_db
    monkeypatch.setattr(application.state, 'storage_ready', True, raising=False)
    monkeypatch.setattr(application.state, 'storage_retry_at', 0, raising=False)
    initialize = Mock(return_value=True)
    monkeypatch.setattr(index, 'initialize_storage', initialize)
    try:
        with TestClient(application, raise_server_exceptions=False) as client:
            yield SimpleNamespace(app=application, client=client, db=db, events=events,
                                  initialize=initialize, control=isolated)
    finally:
        application.dependency_overrides.clear()
        application.dependency_overrides.update(previous)


def assert_safe(response):
    assert response.headers['cache-control'] == 'no-store'
    assert response.headers['x-content-type-options'] == 'nosniff'
    assert response.headers['referrer-policy'] == 'same-origin'
    assert response.headers['access-control-allow-origin'] == ORIGIN
    assert response.headers['access-control-allow-credentials'] == 'true'


@pytest.mark.parametrize('authorization', [None, 'Bearer wrong', 'synthetic-runner'])
def test_scheduler_auth_precedes_coordination_and_storage(integration, authorization):
    s = integration
    s.control.configured.reset_mock()
    headers = {'Origin': ORIGIN}
    if authorization:
        headers['Authorization'] = authorization
    response = s.client.post(runtime.SCHEDULER, headers=headers)
    assert response.status_code == 401
    assert_safe(response)
    s.control.configured.assert_not_called()
    s.control.claim_scheduler.assert_not_called()
    s.initialize.assert_not_called()
    assert s.events == []


def test_missing_scheduler_secret_rejects_even_empty_bearer(integration, monkeypatch):
    monkeypatch.delenv('SCHEDULE_RUNNER_SECRET')
    response = integration.client.post(runtime.SCHEDULER, headers={'Authorization': 'Bearer '})
    assert response.status_code == 401
    integration.control.claim_scheduler.assert_not_called()
    integration.initialize.assert_not_called()
    assert integration.events == []


@pytest.mark.parametrize('action', ['skip', 'busy'])
def test_scheduler_cold_start_skips_without_initialize_or_dependencies(integration, action):
    s = integration
    s.control.claim_scheduler.return_value = {'action': action}
    response = s.client.post(runtime.SCHEDULER, headers={
        'Authorization': 'Bearer synthetic-runner', 'Origin': ORIGIN})
    assert response.status_code == 200
    assert response.json() == {'ok': True, 'skipped': True, 'reason': action}
    assert_safe(response)
    assert s.app.state.storage_ready is False
    s.initialize.assert_not_called()
    assert s.events == []
    s.control.finish_scheduler.assert_not_called()


@pytest.mark.parametrize('path,body,status', [
    ('/api/health/live', {'ok': True}, 200),
    ('/api/runtime-policy', {'client_poll_seconds': 60}, 200),
    ('/api/health/ready', {'ok': True}, 200),
    ('/api/health/ready', {'ok': False}, 503),
])
def test_operational_shortcuts_are_database_free_with_safe_headers(integration, path, body, status):
    s = integration
    s.control.read_health.return_value = {'cached': True, 'ok': body.get('ok', True)}
    response = s.client.get(path, headers={'Origin': ORIGIN})
    assert response.status_code == status
    assert response.json() == body
    assert_safe(response)
    s.initialize.assert_not_called()
    assert s.events == []
    s.control.begin_change.assert_not_called()
    s.control.save_health.assert_not_called()


@pytest.mark.parametrize('path,method', [
    ('/api/auth/me', 'GET'), ('/api/planned-transactions', 'GET'),
    ('/api/maintenance/daily', 'GET'), ('/api/maintenance/update-check', 'GET'),
    ('/api/wallets', 'POST'), ('/api/wallets/1', 'PUT'),
    ('/api/wallets/1', 'PATCH'), ('/api/wallets/1', 'DELETE'),
    ('/api/wallets', 'GET'), ('/api/transactions', 'GET'),
    ('/api/budgets', 'GET'), ('/api/dashboard', 'GET'),
    ('/api/analytics', 'GET'), ('/api/calendar', 'GET'),
    ('/api/shared/transactions', 'GET'),
    ('/api/google/callback', 'GET'), ('/api/new-provider/callback', 'GET'),
])
def test_failed_begin_prevents_initialize_dependencies_and_dispatch(integration, path, method):
    s = integration
    s.control.begin_change.side_effect = runtime.control.CoordinationUnavailable('synthetic')
    response = s.client.request(method, path, headers={'Origin': ORIGIN, 'X-Space-ID': '42'})
    assert response.status_code == 503
    assert response.json()['code'] == 'COORDINATION_UNAVAILABLE'
    assert response.headers['retry-after'] == '30'
    assert_safe(response)
    s.initialize.assert_not_called()
    assert s.events == []
    s.control.end_change.assert_not_called()


@pytest.mark.parametrize('failure', [None, 'handler', 'teardown'])
def test_fence_encloses_dispatch_response_and_entire_dependency_teardown(isolated, failure):
    events = []
    app = FastAPI()

    def dependency():
        events.append('dependency')
        try:
            yield
        finally:
            events.append('teardown')
            if failure == 'teardown':
                raise RuntimeError('synthetic teardown error')

    @app.post('/api/synthetic')
    def mutate(_=Depends(dependency)):
        events.append('dispatch')
        if failure == 'handler':
            raise RuntimeError('synthetic handler error')
        return {'ok': True}

    isolated.begin_change.side_effect = lambda: events.append('begin') or 'own-token'
    isolated.end_change.side_effect = lambda token: events.append(('end', token))
    with TestClient(runtime.ResourceMiddleware(app), raise_server_exceptions=False) as client:
        response = client.post('/api/synthetic')
    assert response.status_code == (500 if failure == 'handler' else 200)
    assert events == ['begin', 'dependency', 'dispatch', 'teardown', ('end', 'own-token')]
    isolated.end_change.assert_called_once_with('own-token')


def test_real_scoped_me_and_planned_side_effects_are_fenced(integration, monkeypatch):
    s = integration
    user = SimpleNamespace(id=7, role='user')
    s.app.dependency_overrides[runtime.current_user] = lambda: user
    s.app.dependency_overrides[planned.workspace_actor] = lambda: user
    monkeypatch.setattr(index, 'user_payload', lambda value: {'id': value.id})
    monkeypatch.setattr(planned, 'shared_wallet_ids', lambda *args: set())
    s.db.query.return_value.filter_by.return_value.all.return_value = []
    monkeypatch.setattr(planned, 'post_due', lambda db: s.events.append('post_due'))
    s.control.begin_change.side_effect = lambda: s.events.append('begin') or 'own-token'
    s.control.end_change.side_effect = lambda token: s.events.append('end')
    for path in ('/api/auth/me', '/api/planned-transactions'):
        s.events.clear()
        response = s.client.get(path, headers={'X-Space-ID': '42'})
        assert response.status_code == 200, response.text
        assert s.events == ['begin', 'dependency', 'post_due', 'teardown', 'end']


def test_ordinary_read_is_not_fenced(integration):
    integration.app.dependency_overrides[index.workspace_user] = lambda: SimpleNamespace(id=7)
    integration.db.query.return_value.filter.return_value.order_by.return_value.all.return_value = []
    response = integration.client.get('/api/categories')
    assert response.status_code == 200
    assert response.json() == []
    assert integration.events == ['dependency', 'teardown']
    integration.control.begin_change.assert_not_called()
    integration.control.end_change.assert_not_called()


@pytest.mark.parametrize('failure', [None, 'handler', 'teardown'])
def test_entrypoint_fence_encloses_real_app_middleware_and_teardown(integration, monkeypatch, failure):
    s = integration
    monkeypatch.setattr(s.app.router, 'routes', list(s.app.router.routes))

    def dependency():
        s.events.append('dependency')
        try:
            yield
        finally:
            s.events.append('teardown')
            if failure == 'teardown':
                raise RuntimeError('synthetic teardown failure')

    @s.app.post('/api/synthetic-resource-runtime-test')
    def mutate(_=Depends(dependency)):
        s.events.append('dispatch')
        if failure == 'handler':
            raise RuntimeError('synthetic dispatch failure')
        return {'ok': True}

    s.control.begin_change.side_effect = lambda: s.events.append('begin') or 'own-token'
    s.control.end_change.side_effect = lambda token: s.events.append(('end', token))
    response = s.client.post('/api/synthetic-resource-runtime-test')
    assert response.status_code == (500 if failure == 'handler' else 200)
    assert s.events == ['begin', 'dependency', 'dispatch', 'teardown', ('end', 'own-token')]


def test_confirmation_failure_keeps_delivered_response_and_does_not_retry(isolated):
    isolated.end_change.side_effect = runtime.control.CoordinationUnavailable('synthetic-private-error')

    async def application(scope, receive, send):
        await send({'type': 'http.response.start', 'status': 201, 'headers': []})
        await send({'type': 'http.response.body', 'body': b'{"ok":true}'})

    response = TestClient(runtime.ResourceMiddleware(application)).post('/api/synthetic')
    assert response.status_code == 201
    assert response.json() == {'ok': True}
    isolated.begin_change.assert_called_once()
    isolated.end_change.assert_called_once_with('token')


@pytest.mark.parametrize('status,marker,expected', [
    (200, True, True), (200, False, False), (400, True, False), (503, True, False),
])
def test_scheduler_finish_receives_claim_next_epoch_and_explicit_success(isolated, status, marker, expected):
    claim = {'action': 'run', 'token': 'lease', 'generation': 'synthetic'}
    isolated.claim_scheduler.return_value = claim

    async def application(scope, receive, send):
        request = Request(scope)
        request.state.resource_next_epoch = 1234567890
        request.state.resource_scheduler_success = marker
        await send({'type': 'http.response.start', 'status': status, 'headers': []})
        await send({'type': 'http.response.body', 'body': b'{}'})

    client = TestClient(runtime.ResourceMiddleware(application))
    response = client.post(runtime.SCHEDULER, headers={'Authorization': 'Bearer synthetic-runner'})
    assert response.status_code == status
    args = isolated.finish_scheduler.call_args.args
    assert args[:3] == (claim, 1234567890, expected)
    assert isinstance(args[3], float)
    isolated.begin_change.assert_not_called()


def test_scheduler_crash_finishes_unsuccessfully(isolated):
    isolated.claim_scheduler.return_value = {'action': 'run', 'token': 'lease'}

    async def application(scope, receive, send):
        raise RuntimeError('synthetic dispatch failure')

    client = TestClient(runtime.ResourceMiddleware(application), raise_server_exceptions=False)
    assert client.post(runtime.SCHEDULER, headers={
        'Authorization': 'Bearer synthetic-runner'}).status_code == 500
    assert isolated.finish_scheduler.call_args.args[1:3] == (None, False)


@pytest.mark.parametrize('status', [200, 503])
@pytest.mark.parametrize('generation', ['synthetic-probe-start:7', None])
def test_uncached_readiness_saves_actual_result_and_probe_generation(isolated, monkeypatch, status, generation):
    clock = SimpleNamespace(value=1800000000.0)
    monkeypatch.setattr(runtime, 'time', SimpleNamespace(time=lambda: clock.value))
    isolated.read_health.return_value = {'cached': False, 'ok': False}
    if generation is not None:
        isolated.read_health.return_value['generation'] = generation

    async def application(scope, receive, send):
        request = Request(scope)
        assert request.state.resource_health_probe is True
        assert request.state.resource_health_generation == generation
        assert request.state.resource_health_started == 1800000000.0
        clock.value += 90
        # A concurrent invalidation must not replace the probe-start generation.
        isolated.read_health.return_value['generation'] = 'synthetic-new-generation:8'
        await send({'type': 'http.response.start', 'status': status, 'headers': []})
        await send({'type': 'http.response.body', 'body': b'{}'})

    client = TestClient(runtime.ResourceMiddleware(application))
    assert client.get('/api/health/ready').status_code == status
    isolated.read_health.assert_called_once_with(1800000000.0)
    isolated.save_health.assert_called_once_with(status == 200, 1800000000.0, generation)
    isolated.begin_change.assert_not_called()
    isolated.end_change.assert_not_called()


def test_readiness_crash_saves_failed_probe_with_original_generation(isolated):
    isolated.read_health.return_value = {
        'cached': False, 'ok': False, 'generation': 'synthetic-probe:3'}

    async def application(scope, receive, send):
        raise RuntimeError('synthetic probe failure')

    client = TestClient(runtime.ResourceMiddleware(application), raise_server_exceptions=False)
    assert client.get('/api/health/ready').status_code == 500
    isolated.save_health.assert_called_once_with(False, ANY, 'synthetic-probe:3')


@pytest.mark.parametrize('ok', [True, False])
def test_cached_readiness_never_republishes_probe_generation(isolated, ok):
    isolated.read_health.return_value = {
        'cached': True, 'ok': ok, 'generation': 'synthetic-cached:2'}
    application = Mock(side_effect=AssertionError('Cached response dispatched application'))
    response = TestClient(runtime.ResourceMiddleware(application)).get('/api/health/ready')
    assert response.status_code == (200 if ok else 503)
    application.assert_not_called()
    isolated.save_health.assert_not_called()


def authenticate(s, role='admin', token_role=None):
    """Use the actual auth dependency, with synthetic user/session persistence."""
    now = utc_now()
    user = SimpleNamespace(id=7, role=role, active=True, password_hash='synthetic-hash')
    session = SimpleNamespace(id='synthetic-session', user_id=7, revoked=False,
                              created_at=now, last_seen=now, label='Synthetic browser')
    s.db.get.side_effect = lambda model, key: user if model is User else session if model is AccountSession else None
    return {'Authorization': 'Bearer ' + index.auth_serializer.dumps({
        'user_id': 7, 'sid': session.id, 'role': token_role or role,
        'credential': hashlib.sha256(user.password_hash.encode()).hexdigest()})}


@pytest.mark.parametrize('method', ['GET', 'PUT'])
def test_policy_requires_actual_admin_role_even_with_admin_token_claim(integration, method):
    s = integration
    headers = authenticate(s, role='user', token_role='admin')
    response = s.client.request(method, '/api/admin/resource-policy', headers=headers,
                                json={'policy': POLICY, 'revision': 'synthetic-revision'})
    assert response.status_code == 403
    s.control.read_state.assert_not_called()
    s.control.update_policy.assert_not_called()


@pytest.mark.parametrize('method', ['GET', 'PUT'])
def test_policy_requires_authentication(integration, method):
    response = integration.client.request(method, '/api/admin/resource-policy',
        json={'policy': POLICY, 'revision': 'synthetic-revision'})
    assert response.status_code == 401
    integration.control.update_policy.assert_not_called()


def test_admin_read_and_compare_and_swap_use_real_permissions(integration):
    s = integration
    headers = authenticate(s)
    assert s.client.get('/api/admin/resource-policy', headers=headers).json() == STATE
    response = s.client.put('/api/admin/resource-policy', headers=headers,
                            json={'policy': POLICY, 'revision': 'expected-revision'})
    assert response.status_code == 200
    assert response.json() == STATE
    s.control.update_policy.assert_called_once_with(POLICY, 'expected-revision')


@pytest.mark.parametrize('error,status', [
    (runtime.control.ConflictError, 409), (runtime.control.CoordinationUnavailable, 503),
])
def test_admin_compare_and_swap_maps_control_failures(integration, error, status):
    s = integration
    s.control.update_policy.side_effect = error('synthetic-private-error')
    response = s.client.put('/api/admin/resource-policy', headers=authenticate(s),
        json={'policy': POLICY, 'revision': 'expected-revision'})
    assert response.status_code == status
    assert 'synthetic-private-error' not in response.text
    s.control.update_policy.assert_called_once_with(POLICY, 'expected-revision')


@pytest.mark.parametrize('field,low,high', [
    ('client_poll_seconds', 15, 300), ('idle_recheck_minutes', 15, 1440),
    ('database_probe_minutes', 15, 1440),
])
@pytest.mark.parametrize('kind', ['low', 'high', 'below', 'above', 'bool', 'float', 'string', 'null'])
def test_policy_strict_integer_bounds(integration, field, low, high, kind):
    s = integration
    value = dict(low=low, high=high, below=low - 1, above=high + 1,
                 bool=True, float=float(low), string=str(low), null=None)[kind]
    policy = {**POLICY, field: value}
    response = s.client.put('/api/admin/resource-policy', headers=authenticate(s),
                            json={'policy': policy, 'revision': 'revision'})
    if kind in ('low', 'high'):
        assert response.status_code == 200
        s.control.update_policy.assert_called_once_with(policy, 'revision')
    else:
        assert response.status_code == 422
        s.control.update_policy.assert_not_called()


@pytest.mark.parametrize('body', [
    {'policy': POLICY, 'revision': ''}, {'policy': POLICY, 'revision': 'x' * 201},
    {'policy': POLICY, 'revision': 1}, {'policy': POLICY},
    {'policy': {**POLICY, 'extra': 1}, 'revision': 'r'},
    {'policy': {'client_poll_seconds': 60}, 'revision': 'r'},
    {'policy': POLICY, 'revision': 'r', 'extra': True},
])
def test_admin_rejects_incomplete_extra_and_invalid_revision_inputs(integration, body):
    s = integration
    response = s.client.put('/api/admin/resource-policy', headers=authenticate(s), json=body)
    assert response.status_code == 422
    s.control.update_policy.assert_not_called()


@pytest.mark.parametrize('outcome,status', [
    ('success', 200), ('conflict', 409), ('unavailable', 503),
    ('unauthenticated', 401), ('forbidden', 403), ('invalid', 422),
])
def test_policy_cas_never_uses_financial_pending_envelope(integration, outcome, status):
    s = integration
    s.control.begin_change.side_effect = AssertionError('Policy PUT entered financial fence')
    state = {**STATE, 'status': {'pending_count': 2}}

    def compare_and_swap(policy, revision):
        s.control.begin_change.assert_not_called()
        s.control.end_change.assert_not_called()
        assert policy == POLICY
        assert revision == 'expected-revision'
        if outcome == 'conflict':
            raise runtime.control.ConflictError('synthetic')
        if outcome == 'unavailable':
            raise runtime.control.CoordinationUnavailable('synthetic')
        return state

    s.control.update_policy.side_effect = compare_and_swap
    headers = {} if outcome == 'unauthenticated' else authenticate(
        s, role='user' if outcome == 'forbidden' else 'admin')
    body = {'policy': POLICY, 'revision': '' if outcome == 'invalid' else 'expected-revision'}
    response = s.client.put('/api/admin/resource-policy', headers=headers, json=body)
    assert response.status_code == status, response.text
    if outcome == 'success':
        assert response.json() == state
        assert response.json()['status']['pending_count'] == 2
    if outcome in ('success', 'conflict', 'unavailable'):
        s.control.update_policy.assert_called_once_with(POLICY, 'expected-revision')
    else:
        s.control.update_policy.assert_not_called()
    s.control.begin_change.assert_not_called()
    s.control.end_change.assert_not_called()


@pytest.mark.parametrize('method,path', [
    ('POST', '/api/admin/resource-policy'),
    ('PATCH', '/api/admin/resource-policy'),
    ('DELETE', '/api/admin/resource-policy'),
    ('PUT', '/api/admin/resource-policy/other'),
    ('PUT', '/api/wallets/1'),
])
def test_policy_put_fence_exemption_is_scoped_to_exact_method_and_path(isolated, method, path):
    async def application(scope, receive, send):
        assert Request(scope).state.resource_change == 'token'
        await send({'type': 'http.response.start', 'status': 200, 'headers': []})
        await send({'type': 'http.response.body', 'body': b'{}'})

    response = TestClient(runtime.ResourceMiddleware(application)).request(method, path)
    assert response.status_code == 200
    isolated.begin_change.assert_called_once_with()
    isolated.end_change.assert_called_once_with('token')


def test_non_http_scope_passes_through_without_coordination(isolated):
    scope = {'type': 'websocket'}
    calls = []

    async def application(scope, receive, send):
        calls.append(scope)

    asyncio.run(runtime.ResourceMiddleware(application)(scope, None, None))
    assert calls == [scope]
    isolated.configured.assert_not_called()


@pytest.mark.parametrize('kind', ['scheduler', 'health'])
@pytest.mark.parametrize('error_type', [RuntimeError, BaseException])
def test_error_after_response_start_cannot_publish_success(isolated, kind, error_type):
    isolated.claim_scheduler.return_value = {'action': 'run', 'token': 'lease', 'generation': 'g'}
    isolated.read_health.return_value = {'cached': False, 'ok': False, 'generation': 'g'}

    async def application(scope, receive, send):
        Request(scope).state.resource_scheduler_success = True
        await send({'type': 'http.response.start', 'status': 200, 'headers': []})
        raise error_type('synthetic teardown error')

    async def receive():
        return {'type': 'http.request', 'body': b''}

    async def send(message):
        pass

    scope = {'type': 'http', 'method': 'POST' if kind == 'scheduler' else 'GET',
             'path': runtime.SCHEDULER if kind == 'scheduler' else '/api/health/ready',
             'headers': [(b'authorization', b'Bearer synthetic-runner')], 'query_string': b''}
    with pytest.raises(error_type, match='synthetic teardown error'):
        asyncio.run(runtime.ResourceMiddleware(application)(scope, receive, send))
    if kind == 'scheduler':
        assert isolated.finish_scheduler.call_args.args[2] is False
    else:
        isolated.save_health.assert_called_once_with(False, ANY, 'g')


@pytest.mark.parametrize('outcome', ['success', 'failure', 'exception', 'begin-unavailable'])
def test_bootstrap_holds_own_confirmed_pending_token(monkeypatch, isolated, outcome):
    app = FastAPI()
    app.state.storage_ready = False
    app.state.storage_retry_at = 0
    events = []
    isolated.begin_change.side_effect = lambda: events.append('begin') or 'bootstrap-token'
    isolated.end_change.side_effect = lambda token: events.append(('end', token))

    def initialize(application):
        assert application is app
        events.append('initialize')
        if outcome == 'exception':
            raise RuntimeError('synthetic bootstrap error')
        return outcome == 'success'

    internal = Mock(side_effect=initialize)
    monkeypatch.setattr(index, '_initialize_storage', internal)
    if outcome == 'begin-unavailable':
        isolated.begin_change.side_effect = runtime.control.CoordinationUnavailable('synthetic')
        assert index.initialize_storage(app) is False
        internal.assert_not_called()
        isolated.end_change.assert_not_called()
        assert app.state.storage_retry_at > 0
    else:
        if outcome == 'exception':
            with pytest.raises(RuntimeError, match='synthetic bootstrap error'):
                index.initialize_storage(app)
        else:
            assert index.initialize_storage(app) is (outcome == 'success')
        assert events == ['begin', 'initialize', ('end', 'bootstrap-token')]


@pytest.fixture
def end_to_end(monkeypatch, isolated):
    """Real Lua and SQL on isolated in-memory stores, with outbound delivery mocked."""
    from api import operations, timekeeping, update_push, upcoming_reminders

    clock = SimpleNamespace(utc=datetime(2026, 10, 23, 9, tzinfo=timezone.utc))

    def local_now():
        return clock.utc.astimezone(timekeeping.KUWAIT).replace(tzinfo=None)

    class Clock:
        @staticmethod
        def now(zone):
            return clock.utc.astimezone(zone)

    monkeypatch.setattr(runtime, 'time', SimpleNamespace(time=lambda: clock.utc.timestamp()))
    monkeypatch.setattr(operations, 'datetime', Clock)
    monkeypatch.setattr(planned, 'ledger_now', local_now)
    monkeypatch.setattr(timekeeping, 'now', local_now)
    monkeypatch.setattr(update_push, 'dispatch_scheduled', Mock(return_value={'sent': 0, 'failed': 0}))
    monkeypatch.setattr(upcoming_reminders, 'dispatch_upcoming', Mock(return_value={'sent': 0, 'failed': 0}))

    engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    database.Base.metadata.create_all(engine)
    with Session(engine) as db:
        user = User(username='Synthetic runtime', email='runtime@example.test', password_hash='unused', active=True)
        db.add(user)
        db.flush()
        wallet = Wallet(user_id=user.id, name='Synthetic wallet', initial_balance=Decimal('100'))
        db.add(wallet)
        db.flush()
        db.add(PlannedTransaction(owner_id=user.id, created_by_id=user.id, wallet_id=wallet.id,
            type='expense', amount=Decimal('10'), description='First synthetic plan',
            due_at=local_now() - timedelta(minutes=1), reporting_month='2026-10',
            status='scheduled', reminder_enabled=False))
        db.commit()
        user_id, wallet_id = user.id, wallet.id

    sql = []

    def count_sql(connection, cursor, statement, parameters, context, executemany):
        sql.append(statement)

    event.listen(engine, 'before_cursor_execute', count_sql)
    app = import_module('api.app').app
    previous = dict(app.dependency_overrides)
    dependencies = []

    def get_db():
        dependencies.append('open')
        with Session(engine) as db:
            yield db
        dependencies.append('close')

    def current_user(db=Depends(database.get_db)):
        return db.get(User, user_id)

    app.dependency_overrides[database.get_db] = get_db
    app.dependency_overrides[runtime.current_user] = current_user
    monkeypatch.setattr(app.state, 'storage_ready', True, raising=False)
    monkeypatch.setattr(app.state, 'storage_retry_at', 0, raising=False)
    initialize = Mock(side_effect=AssertionError('Synthetic schema already initialized'))
    monkeypatch.setattr(index, 'initialize_storage', initialize)

    with fakeredis.FakeRedis(decode_responses=True, version=(7, 0)) as redis:
        assert redis.eval("return cjson.decode(ARGV[1]).value", 0, '{"value":1}') == 1
        transport = SimpleNamespace(failed=False, commands=[])

        def execute(command):
            transport.commands.append(command)
            if transport.failed:
                raise OSError('Synthetic coordination provider unavailable')
            return redis.execute_command(*command)

        coordinator = runtime.control.Coordinator(executor=execute, environ={
            'UPSTASH_REDIS_REST_URL': 'https://synthetic.upstash.io',
            'UPSTASH_REDIS_REST_TOKEN': 'synthetic-token',
            'APP_SECRET': 'synthetic-secret', 'VERCEL_ENV': 'local',
            'BUDGETLY_COORDINATION_NAMESPACE': 'runtime-integration',
            'FLOWBUDGET_DATABASE_URL': 'sqlite://',
        })
        # Separate Lua cases verify the 600-second startup drain. Exercise the
        # steady-state SQL/idle flow only after that safety window has elapsed.
        earlier = clock.utc.timestamp() - 600
        warmup = coordinator.claim_scheduler(earlier)
        coordinator.finish_scheduler(warmup, None, True, earlier)
        for name in ('configured', 'read_state', 'read_health', 'claim_scheduler',
                     'begin_change', 'end_change', 'finish_scheduler', 'save_health', 'update_policy'):
            monkeypatch.setattr(runtime.control, name, getattr(coordinator, name))
        try:
            with TestClient(app, raise_server_exceptions=False) as client:
                # Lifespan deliberately leaves optimized cold starts uninitialized.
                app.state.storage_ready = True
                yield SimpleNamespace(client=client, coordinator=coordinator, transport=transport,
                    sql=sql, dependencies=dependencies, engine=engine, wallet_id=wallet_id,
                    user_id=user_id, clock=clock, local_now=local_now, initialize=initialize)
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(previous)
            event.remove(engine, 'before_cursor_execute', count_sql)
            engine.dispose()


def ledger_snapshot(s):
    with Session(s.engine) as db:
        wallet = db.get(Wallet, s.wallet_id)
        rows = db.query(Transaction).order_by(Transaction.id).all()
        plans = db.query(PlannedTransaction).order_by(PlannedTransaction.id).all()
        return (index.wallet_balance(db, wallet),
                [(row.id, row.description, row.amount) for row in rows],
                [(row.id, row.status, row.posted_transaction_id) for row in plans])


def test_real_lua_sql_scheduler_posts_once_skips_and_mutation_invalidates(end_to_end):
    s = end_to_end
    headers = {'Authorization': 'Bearer synthetic-runner'}
    response = s.client.post(runtime.SCHEDULER, headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()['scheduled_transactions_posted'] == 1
    first = ledger_snapshot(s)
    assert first[0] == 90
    assert len(first[1]) == 1
    assert first[2][0][1:] == ('posted', first[1][0][0])

    s.sql.clear()
    s.dependencies.clear()
    response = s.client.post(runtime.SCHEDULER, headers=headers)
    assert response.json() == {'ok': True, 'skipped': True, 'reason': 'skip'}
    assert s.sql == []
    assert s.dependencies == []
    assert ledger_snapshot(s) == first

    payload = {'transaction': {'type': 'expense', 'amount': 7,
        'description': 'Second synthetic plan', 'wallet_id': s.wallet_id,
        'date': (s.local_now() + timedelta(minutes=1)).isoformat()},
        'status': 'scheduled', 'reminder_enabled': False}
    response = s.client.post('/api/planned-transactions', json=payload)
    assert response.status_code == 201, response.text
    assert response.json()['status'] == 'scheduled'
    after_save = ledger_snapshot(s)
    assert after_save[0] == 90
    assert after_save[1] == first[1]
    assert s.coordinator.read_state()['status']['pending_count'] == 0
    s.clock.utc += timedelta(minutes=2)
    response = s.client.post(runtime.SCHEDULER, headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()['scheduled_transactions_posted'] == 1
    final = ledger_snapshot(s)
    assert final[0] == 83
    assert len(final[1]) == 2
    assert len({row[2] for row in final[2]}) == 2
    assert all(row[1] == 'posted' for row in final[2])

    # Force another real dispatch, proving duplicate protection beyond idle skips.
    token = s.coordinator.begin_change()
    s.coordinator.end_change(token)
    response = s.client.post(runtime.SCHEDULER, headers=headers)
    assert response.json()['scheduled_transactions_posted'] == 0
    assert ledger_snapshot(s) == final
    s.sql.clear()
    s.dependencies.clear()
    assert s.client.post(runtime.SCHEDULER, headers=headers).json()['reason'] == 'skip'
    assert s.sql == []
    assert s.dependencies == []
    s.initialize.assert_not_called()


def test_real_coordinator_provider_failure_rejects_mutation_without_sql(end_to_end):
    s = end_to_end
    before = ledger_snapshot(s)
    s.transport.failed = True
    s.transport.commands.clear()
    s.sql.clear()
    s.dependencies.clear()
    response = s.client.post('/api/planned-transactions', json={
        'transaction': {'type': 'expense', 'amount': 7, 'description': 'Blocked plan',
            'wallet_id': s.wallet_id, 'date': (s.local_now() + timedelta(minutes=1)).isoformat()},
        'status': 'scheduled', 'reminder_enabled': False})
    assert response.status_code == 503
    assert response.json()['code'] == 'COORDINATION_UNAVAILABLE'
    assert s.sql == []
    assert s.dependencies == []
    assert len(s.transport.commands) == 1
    command = s.transport.commands[0]
    assert command[3 + command[2]] == 'begin'
    assert ledger_snapshot(s) == before
    s.initialize.assert_not_called()
