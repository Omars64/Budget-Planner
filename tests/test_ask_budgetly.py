"""Focused assistant regression tests. In-memory database; no provider traffic."""
import json
import uuid
from unittest.mock import Mock
import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from api.app import app
from api.database import Base, get_db
from api.index import current_user
from api.models import User, Wallet, Note
from api.ai_models import AssistantConfig
from api import ai_service, ai_settings, ai_provider


@pytest.fixture
def setup(monkeypatch):
    engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    monkeypatch.setattr(app.state, 'storage_ready', True, raising=False)
    with Session(engine) as db:
        user = User(username='Test', email='assistant-test@example.com', password_hash='unused', role='admin')
        db.add(user); db.flush()
        db.add(Wallet(user_id=user.id, name='Main', initial_balance=10)); db.commit()
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[current_user] = lambda: user
        monkeypatch.setenv('OPENAI_API_KEY', 'test-only-not-a-real-key')
        monkeypatch.setenv('OPENAI_MODEL', 'gpt-4o-mini')
        provider = Mock(return_value={'answer': 'A suggested plan.', 'usage': {'provider': 'openai'}})
        monkeypatch.setattr(ai_service, 'complete', provider)
        client = TestClient(app)
        yield client, db, user, provider
        client.close()
        app.dependency_overrides.clear()
    engine.dispose()


def create(client, scope='personal', wallet_id=None):
    result = client.post('/api/ai/chats', json={'id': str(uuid.uuid4()), 'scope': scope, 'wallet_id': wallet_id, 'month': '2026-09'})
    assert result.status_code == 201, result.text
    return result.json()['id']


def test_admin_switch_reauth_roles_and_default_off(setup, monkeypatch):
    client, db, user, provider = setup
    assert client.get('/api/admin/assistant').json()['enabled'] is False
    assert client.put('/api/admin/assistant', json={'enabled': True}).status_code == 428
    monkeypatch.setattr(ai_settings, 'confirmed', lambda *args: None)
    user.role = 'user'; db.commit()
    assert client.put('/api/admin/assistant', json={'enabled': True}).status_code == 403
    user.role = 'admin'; db.commit()
    assert client.put('/api/admin/assistant', json={'enabled': True}).json()['available'] is True
    assert client.get('/api/ai/config').json()['ai_available'] is True
    monkeypatch.setenv('OPENAI_MODEL', 'another/model')
    assert client.put('/api/admin/assistant', json={'enabled': True}).status_code == 422
    assert client.get('/api/ai/config').json()['ai_available'] is False
    assert client.put('/api/admin/assistant', json={'enabled': False}).status_code == 200
    assert 'test-only-not-a-real-key' not in client.get('/api/admin/assistant').text
    provider.assert_not_called()


def test_local_saved_conversation_and_idempotent_note(setup):
    client, db, user, provider = setup
    chat = create(client)
    body = {'request_id': str(uuid.uuid4()), 'question': 'How do I share a wallet?'}
    first = client.post(f'/api/ai/chats/{chat}/messages', json=body).json()
    assert first['status'] == 'completed', first
    assert '**Shared transactions**' in first['answer']
    assert client.post(f'/api/ai/chats/{chat}/messages', json=body).json()['id'] == first['id']
    saved = client.get(f'/api/ai/chats/{chat}').json()
    assert len(saved['turns']) == 1
    note = client.post(f"/api/ai/turns/{first['id']}/save-note").json()['note_id']
    assert client.post(f"/api/ai/turns/{first['id']}/save-note").json()['note_id'] == note
    assert db.get(Note, note).content == first['answer']
    provider.assert_not_called()


def test_enabled_routing_and_outage_fallback(setup):
    client, db, user, provider = setup
    db.add(AssistantConfig(id=1, enabled=True)); db.commit()
    chat = create(client, 'general')
    result = client.post(f'/api/ai/chats/{chat}/messages', json={'request_id': str(uuid.uuid4()), 'question': 'Explain budgeting.'}).json()
    assert result['provider'] == 'openai'
    assert set(provider.call_args.args[0]) == {'as_of', 'currency', 'scope', 'month'}
    provider.side_effect = httpx.ConnectError('sensitive upstream error')
    result = client.post(f'/api/ai/chats/{chat}/messages', json={'request_id': str(uuid.uuid4()), 'question': 'How do I create a budget?'}).json()
    assert result['status'] == 'completed' and result['provider'] == 'built-in'
    assert 'temporarily unavailable' in result['notice']
    assert 'sensitive' not in json.dumps(result)
    db.get(AssistantConfig, 1).enabled = False; db.commit()
    provider.reset_mock()
    client.post(f'/api/ai/chats/{chat}/messages', json={'request_id': str(uuid.uuid4()), 'question': 'How do I add a transaction?'})
    provider.assert_not_called()


def test_wallet_scope_and_conversation_ownership(setup):
    client, db, user, provider = setup
    other = User(username='Other', email='other@example.com', password_hash='unused')
    db.add(other); db.flush()
    wallet = Wallet(user_id=other.id, name='Private', initial_balance=999)
    db.add(wallet); db.commit()
    r = client.post('/api/ai/chats', json={'id': str(uuid.uuid4()), 'scope': 'shared', 'wallet_id': wallet.id, 'month': '2026-09'})
    assert r.status_code in (403, 404)
    chat = create(client)
    app.dependency_overrides[current_user] = lambda: other
    assert client.get(f'/api/ai/chats/{chat}').status_code == 404
    assert client.delete(f'/api/ai/chats/{chat}').status_code == 404


@pytest.mark.parametrize('category', ['Pet care', 'Education', 'Travel', 'Food & Dining'])
def test_roadmaps_support_custom_categories(category):
    facts = {'scope': 'personal', 'currency': 'KWD', 'month': '2026-09',
             'categories': [{'name': category, 'kind': 'expense'}],
             'ledger': {'expense_categories': [{'category': category, 'amount': '45'}]}}
    answer = ai_service._local_answer(facts, f'Create a roadmap to reduce my spending on {category}')
    assert category in answer and 'Week 4' in answer and 'KWD 45.000' in answer
    assert 'Food' not in answer or category == 'Food & Dining'


def test_openai_request_contract(monkeypatch):
    monkeypatch.setenv('OPENAI_API_KEY', 'test-key')
    real_client = httpx.Client
    def handle(request):
        assert str(request.url) == 'https://api.openai.com/v1/chat/completions'
        payload = json.loads(request.content)
        assert payload['model'] == 'gpt-4o-mini'
        assert payload['max_completion_tokens'] == 1800 and payload['store'] is False
        assert request.headers['authorization'] == 'Bearer test-key'
        assert not {'models', 'tools', 'provider'}.intersection(payload)
        return httpx.Response(200, json={'choices': [{'message': {'content': 'Test response'}}]})
    monkeypatch.setattr(ai_provider.httpx, 'Client', lambda **kwargs: real_client(transport=httpx.MockTransport(handle), **kwargs))
    assert ai_provider.complete({}, 'Explain budgeting', [], 'Guide')['answer'] == 'Test response'


def test_missing_key_never_calls_provider(setup, monkeypatch):
    client, db, user, provider = setup
    db.add(AssistantConfig(id=1, enabled=True)); db.commit()
    monkeypatch.delenv('OPENAI_API_KEY')
    chat = create(client)
    result = client.post(f'/api/ai/chats/{chat}/messages', json={'request_id': str(uuid.uuid4()), 'question': 'Explain budgeting.'}).json()
    assert result['provider'] == 'built-in'
    provider.assert_not_called()


def test_tutorial_completion_is_account_scoped_and_survives_settings_save(setup):
    client, db, user, _ = setup
    assert client.get('/api/tutorial').json() == {'status': 'not_started'}
    assert client.put('/api/tutorial', json={'status': 'skipped'}).json() == {'status': 'skipped'}
    settings = client.get('/api/settings').json()
    assert client.put('/api/settings', json=settings).status_code == 200
    assert client.get('/api/tutorial').json()['status'] == 'skipped'
    assert client.put('/api/tutorial', json={'status': 'completed'}).status_code == 200
    assert client.put('/api/tutorial', json={'status': 'invalid'}).status_code == 422
    other = User(username='Other', email='tutorial-other@example.com', password_hash='unused')
    db.add(other); db.commit()
    app.dependency_overrides[current_user] = lambda: other
    assert client.get('/api/tutorial').json()['status'] == 'not_started'
    app.dependency_overrides[current_user] = lambda: user
    assert client.get('/api/tutorial').json()['status'] == 'completed'
