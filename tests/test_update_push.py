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
