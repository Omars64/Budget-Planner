"""Database-free policy API contracts with actual control Lua; no app bootstrap."""
import importlib.util
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace

import fakeredis
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


@pytest.fixture
def policy_api(monkeypatch):
    root = Path(__file__).parents[1] / 'api'
    package = ModuleType('policy_contract_isolated')
    package.__path__ = [str(root)]
    monkeypatch.setitem(sys.modules, package.__name__, package)
    auth = ModuleType(package.__name__ + '.auth_dependency')
    actor = SimpleNamespace(id=7, role='admin')
    auth.current_user = lambda: actor
    monkeypatch.setitem(sys.modules, auth.__name__, auth)
    spec = importlib.util.spec_from_file_location(package.__name__ + '.resource_runtime', root / 'resource_runtime.py')
    runtime = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runtime)
    with fakeredis.FakeRedis(decode_responses=True) as redis:
        c = runtime.control.Coordinator(lambda cmd: redis.execute_command(*cmd), {
            'UPSTASH_REDIS_REST_URL': 'https://synthetic.test',
            'UPSTASH_REDIS_REST_TOKEN': 'synthetic', 'VERCEL_ENV': 'production'})
        for name in ('read_state', 'update_policy', 'read_history', 'read_metrics'):
            monkeypatch.setattr(runtime.control, name, getattr(c, name))
        app = FastAPI()
        app.include_router(runtime.router)
        with TestClient(app) as client:
            yield client, c, actor


def test_policy_api_audit_actor_and_metrics_flat(policy_api):
    client, control, _ = policy_api
    state = client.get('/api/admin/resource-policy').json()
    state['policy']['client_idle_minutes'] = 40
    response = client.put('/api/admin/resource-policy', json={k: state[k] for k in ('policy', 'revision')})
    assert response.status_code == 200
    items = client.get('/api/admin/resource-policy/history').json()['items']
    assert items[0]['actor_id'] == '7'
    assert type(items[0]['at']) is int
    assert items[0]['changes'] == {'client_idle_minutes': {'before': 30, 'after': 40}}
    assert control.record_metric('ai_attempts', 3)
    for path in ('/api/admin/resource-metrics', '/api/admin/resource-policy/metrics'):
        value = client.get(path).json()
        assert value['metrics'] == {'ai_attempts': 3}
        assert value['since'] > 0
        assert value['reset_at'] is None


def test_policy_api_admin_limits_and_failure(policy_api, monkeypatch):
    client, control, actor = policy_api
    assert client.get('/api/admin/resource-policy/history?limit=0').status_code == 422
    assert client.get('/api/admin/resource-policy/history?limit=101').status_code == 422
    actor.role = 'user'
    for path in ('/api/admin/resource-policy/history', '/api/admin/resource-metrics'):
        assert client.get(path).status_code == 403
    actor.role = 'admin'
    def unavailable(*args):
        raise sys.modules[type(control).__module__].CoordinationUnavailable('synthetic')
    monkeypatch.setattr(control, '_call', unavailable)
    for path in ('/api/admin/resource-policy/history', '/api/admin/resource-metrics'):
        assert client.get(path).status_code == 503
