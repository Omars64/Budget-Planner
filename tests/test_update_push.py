import base64
from uuid import uuid4
import pytest
from cryptography.fernet import Fernet
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from api.database import Base, get_db
from api.index import current_user
from api.models import User
from api import update_push as push


@pytest.fixture
def workspace(monkeypatch):
    monkeypatch.setenv('UPDATE_PUSH_ENCRYPTION_KEY', Fernet.generate_key().decode())
    monkeypatch.setenv('WEB_PUSH_PUBLIC_KEY', 'public')
    monkeypatch.setenv('WEB_PUSH_PRIVATE_KEY', 'private')
    monkeypatch.setenv('WEB_PUSH_SUBJECT', 'mailto:admin@example.test')
    engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        user = User(username='Push', email='push@example.test', password_hash='unused')
        db.add(user); db.commit()
        app = FastAPI(); app.include_router(push.router)
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[current_user] = lambda: user
        yield TestClient(app), db, user
    engine.dispose()


def subscription():
    encode = lambda value: base64.urlsafe_b64encode(value).decode().rstrip('=')
    return {'endpoint': 'https://fcm.googleapis.com/fcm/send/test', 'keys': {'p256dh': encode(b'\x04' + b'a'*64), 'auth': encode(b'a'*16)}}


def payload():
    return {'id': str(uuid4()), 'platform': 'browser', 'version': '1.0.0', 'subscription': subscription()}


def test_encrypted_owned_registration_and_unsubscribe(workspace):
    client, db, user = workspace
    body = payload()
    assert client.put('/api/app-updates/push-device', json=body).status_code == 200
    row = db.get(push.UpdatePushDevice, body['id'])
    assert 'fcm.googleapis.com' not in row.payload
    assert row.user_id == user.id
    assert client.put('/api/app-updates/push-device', json=body).status_code == 200
    assert db.query(push.UpdatePushDevice).count() == 1
    assert client.delete('/api/app-updates/push-device/'+body['id']).status_code == 204
    assert db.query(push.UpdatePushDevice).count() == 0


@pytest.mark.parametrize('url', ['http://fcm.googleapis.com/x', 'https://127.0.0.1/x', 'https://example.test/x', 'https://user@fcm.googleapis.com/x', 'https://fcm.googleapis.com:444/x'])
def test_rejects_private_or_untrusted_destinations(workspace, url):
    client, db, _ = workspace
    body = payload(); body['subscription']['endpoint'] = url
    assert client.put('/api/app-updates/push-device', json=body).status_code == 422
    assert db.query(push.UpdatePushDevice).count() == 0


def test_disabled_configuration_never_registers(workspace, monkeypatch):
    client, db, _ = workspace
    monkeypatch.delenv('WEB_PUSH_PRIVATE_KEY')
    assert client.get('/api/app-updates/push-config').json()['browser'] is False
    assert client.put('/api/app-updates/push-device', json=payload()).status_code == 503
    assert db.query(push.UpdatePushDevice).count() == 0


def test_daily_delivery_deduplicates_retries_and_removes_expired(workspace, monkeypatch):
    client, db, _ = workspace
    body = payload(); client.put('/api/app-updates/push-device', json=body)
    send = []
    monkeypatch.setattr(push, 'send_device', lambda row, version: send.append(version) or 200)
    assert push.dispatch_updates(db)['sent'] == 1
    assert push.dispatch_updates(db)['sent'] == 0
    assert len(send) == 1
    row = db.get(push.UpdatePushDevice, body['id']); row.last_version = None; db.commit()
    monkeypatch.setattr(push, 'send_device', lambda *_: 503)
    assert push.dispatch_updates(db)['failed'] == 1
    assert row.last_version is None
    monkeypatch.setattr(push, 'send_device', lambda *_: 410)
    push.dispatch_updates(db)
    assert db.query(push.UpdatePushDevice).count() == 0


def test_no_push_for_current_or_inactive_users(workspace, monkeypatch):
    client, db, user = workspace
    body = payload(); body['version'] = push.VERSION
    client.put('/api/app-updates/push-device', json=body)
    monkeypatch.setattr(push, 'send_device', lambda *_: pytest.fail('Unexpected send'))
    assert push.dispatch_updates(db)['sent'] == 0
    row = db.get(push.UpdatePushDevice, body['id']); row.installed_version = '1.0.0'; row.last_version = None
    user.active = False; db.commit()
    assert push.dispatch_updates(db)['sent'] == 0


def test_authentication_required():
    app = FastAPI(); app.include_router(push.router)
    with TestClient(app) as client:
        assert client.put('/api/app-updates/push-device', json=payload()).status_code == 401


def test_web_sender_accepts_private_pem_without_network(workspace, monkeypatch):
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives import serialization
    from py_vapid import Vapid01
    import pywebpush
    client, db, _ = workspace
    key = ec.generate_private_key(ec.SECP256R1()).private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()
    monkeypatch.setenv('WEB_PUSH_PRIVATE_KEY', key)
    calls = []
    monkeypatch.setattr(pywebpush, 'webpush', lambda *args, **kwargs: calls.append((args, kwargs)))
    body = payload(); client.put('/api/app-updates/push-device', json=body)
    assert push.send_device(db.get(push.UpdatePushDevice, body['id']), '99.0.0') == 200
    assert isinstance(calls[0][1]['vapid_private_key'], Vapid01)
    assert calls[0][1]['timeout'] == 5


def test_device_status_is_owned_and_never_exposes_subscription(workspace):
    client, db, user = workspace
    body = payload(); client.put('/api/app-updates/push-device', json=body)
    other = User(username='Other', email='other@example.test', password_hash='unused')
    db.add(other); db.flush()
    db.add(push.UpdatePushDevice(id=str(uuid4()), user_id=other.id, platform='browser', payload='private', installed_version='1.0.0'))
    db.commit()
    result = client.get('/api/app-updates/push-devices')
    assert result.status_code == 200
    assert result.headers['cache-control'] == 'no-store'
    assert [item['id'] for item in result.json()['devices']] == [body['id']]
    assert 'payload' not in result.text and 'endpoint' not in result.text


def test_test_delivery_does_not_mark_release_seen_and_is_rate_limited(workspace, monkeypatch):
    client, db, _ = workspace
    body = payload(); client.put('/api/app-updates/push-device', json=body)
    calls = []
    monkeypatch.setattr(push, 'send_device', lambda row, version, test=False: calls.append((version,test)) or 200)
    path = '/api/app-updates/push-device/' + body['id'] + '/test'
    for _ in range(3):
        result = client.post(path)
        assert result.status_code == 200 and result.json()['accepted'] is True
    assert client.post(path).status_code == 429
    assert calls == [('1.0.0', True)] * 3
    assert db.get(push.UpdatePushDevice, body['id']).last_version is None


def test_test_delivery_requires_ownership_and_removes_expired_registration(workspace, monkeypatch):
    client, db, _ = workspace
    assert client.post('/api/app-updates/push-device/' + str(uuid4()) + '/test').status_code == 404
    body = payload(); client.put('/api/app-updates/push-device', json=body)
    monkeypatch.setattr(push, 'send_device', lambda *args, **kwargs: 410)
    assert client.post('/api/app-updates/push-device/' + body['id'] + '/test').status_code == 409
    assert db.get(push.UpdatePushDevice, body['id']) is None


def test_android_uses_visible_high_priority_without_exposing_financial_data(workspace, monkeypatch):
    import httpx
    from google.oauth2 import service_account
    from types import SimpleNamespace
    monkeypatch.setenv('FIREBASE_SERVICE_ACCOUNT_JSON', '{}')
    fake = SimpleNamespace(project_id='budgetly-test', token='private', refresh=lambda request: None)
    monkeypatch.setattr(service_account.Credentials, 'from_service_account_info', lambda *args, **kwargs: fake)
    calls = []
    real_client = httpx.Client
    def receive(request):
        import json
        calls.append(json.loads(request.content))
        return httpx.Response(200, json={'name':'accepted'})
    monkeypatch.setattr(httpx, 'Client', lambda **kwargs: real_client(transport=httpx.MockTransport(receive), **kwargs))
    row = push.UpdatePushDevice(platform='android', installed_version='1.0.0', payload=push.cipher().encrypt(b'"test-registration-token"').decode())
    assert push.send_device(row, '99.0.0') == 200
    assert calls[0]['message']['android']['priority'] == 'high'
    assert 'notification' not in calls[0]['message']
    assert calls[0]['message']['data']['budgetlyUpdate'] == 'true'
    assert push.send_device(row, '1.0.0', test=True) == 200
    assert calls[1]['message']['notification']['title'] == 'Budgetly test notification'
    assert calls[1]['message']['android']['ttl'] == '300s'


def test_release_trigger_has_separate_update_only_authentication(workspace, monkeypatch):
    from api import operations
    client, db, _ = workspace
    app = FastAPI(); app.include_router(operations.router)
    app.dependency_overrides[get_db] = lambda: db
    monkeypatch.setenv('UPDATE_RELEASE_SECRET', 'release-only')
    monkeypatch.setenv('CRON_SECRET', 'maintenance-only')
    monkeypatch.setattr(push, 'dispatch_updates', lambda db: {'configured':True,'sent':0,'failed':0})
    with TestClient(app) as release_client:
        path = '/api/maintenance/release-updates'
        assert release_client.post(path).status_code == 401
        assert release_client.post(path, headers={'Authorization':'Bearer maintenance-only'}).status_code == 401
        assert release_client.post(path, headers={'Authorization':'Bearer release-only'}).status_code == 200
        assert release_client.get('/api/maintenance/update-check', headers={'Authorization':'Bearer release-only'}).status_code == 401
