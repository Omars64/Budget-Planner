import hashlib
import json
from datetime import timedelta
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from cryptography.fernet import Fernet
from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from api import google_drive as drive
from api.database import Base, get_db
from api.models import User, utc_now


@pytest.fixture
def setup(monkeypatch):
    key = Fernet.generate_key()
    for name, value in {'CLIENT_ID': 'drive-client', 'CLIENT_SECRET': 'client-secret',
                        'REDIRECT_URI': 'https://budgetly.test/api/google-drive/callback',
                        'ENCRYPTION_KEY': key.decode()}.items():
        monkeypatch.setenv('GOOGLE_DRIVE_' + name, value)
    engine = create_engine('sqlite://', poolclass=StaticPool, connect_args={'check_same_thread': False})
    @event.listens_for(engine, 'connect')
    def enable_fk(connection, _):
        connection.execute('PRAGMA foreign_keys=ON')
    Base.metadata.create_all(engine)
    db = Session(engine)
    db.add_all([User(id=1, username='one', email='one@test.local', password_hash='unused'),
                User(id=2, username='two', email='two@test.local', password_hash='unused')])
    db.commit()
    app = FastAPI()
    app.include_router(drive.router)
    def user(request: Request):
        token = request.headers.get('Authorization')
        if token not in ('Bearer one', 'Bearer two'):
            raise HTTPException(401, 'Sign in')
        return db.get(User, 1 if token == 'Bearer one' else 2)
    app.dependency_overrides[drive.current_user] = user
    app.dependency_overrides[get_db] = lambda: db
    requests = []
    def handler(request):
        requests.append(request)
        if str(request.url) == drive.TOKEN_URL:
            return httpx.Response(200, json={'access_token': 'access-secret', 'refresh_token': 'refresh-secret', 'scope': drive.SCOPE})
        return httpx.Response(200, json={'id': 'file_1', 'files': []})
    handlers = [handler]
    transport = httpx.MockTransport(lambda request: handlers[0](request))
    original = httpx.AsyncClient
    monkeypatch.setattr(drive.httpx, 'AsyncClient', lambda **kwargs: original(transport=transport, **kwargs))
    with TestClient(app) as client:
        yield client, db, key, requests, lambda value: handlers.__setitem__(0, value)
    db.close()
    engine.dispose()

HEADERS = {'Authorization': 'Bearer one'}
OTHER = {'Authorization': 'Bearer two'}


def start(client):
    response = client.post('/api/google-drive/start', headers=HEADERS)
    assert response.status_code == 200, response.text
    flow = response.json()
    state = parse_qs(urlsplit(flow['authorization_url']).query)['state'][0]
    return flow, state


def connect(client):
    flow, state = start(client)
    response = client.get('/api/google-drive/callback', params={'state': state, 'code': 'authorization-code'})
    assert response.status_code == 200
    return flow


def test_pkce_encryption_poll_and_replay(setup):
    client, db, key, requests, _ = setup
    flow, state = start(client)
    query = parse_qs(urlsplit(flow['authorization_url']).query)
    assert query['scope'] == [drive.SCOPE]
    assert query['code_challenge_method'] == ['S256']
    assert 'poll_secret' not in query
    row = db.get(drive.GoogleDriveOAuthAttempt, flow['flow_id'])
    verifier = Fernet(key).decrypt(row.verifier.encode()).decode()
    assert query['code_challenge'] == [drive.base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')]
    assert row.state_hash != state and row.poll_hash != flow['poll_secret']
    assert client.post('/api/google-drive/poll', headers=OTHER, json={k: flow[k] for k in ('flow_id', 'poll_secret')}).status_code == 404
    assert client.post('/api/google-drive/poll', headers=HEADERS, json={'flow_id': flow['flow_id'], 'poll_secret': 'wrong-secret-value-12345'}).status_code == 404
    response = client.get('/api/google-drive/callback', params={'state': state, 'code': 'authorization-code'})
    assert response.status_code == 200 and response.headers['cache-control'] == 'no-store'
    assert 'refresh-secret' not in response.text and 'access-secret' not in response.text
    connection = db.get(drive.GoogleDriveConnection, 1)
    assert connection.refresh_token != 'refresh-secret'
    assert Fernet(key).decrypt(connection.refresh_token.encode()) == b'refresh-secret'
    db.refresh(row)
    assert row.verifier is None
    exchange = parse_qs(requests[0].content.decode())
    assert exchange['code_verifier'] == [verifier]
    assert client.get('/api/google-drive/callback', params={'state': state, 'code': 'replay'}).status_code == 400
    assert len(requests) == 1
    polled = client.post('/api/google-drive/poll', headers=HEADERS, json={k: flow[k] for k in ('flow_id', 'poll_secret')})
    assert polled.json() == {'status': 'connected', 'connected': True}


@pytest.mark.parametrize('path,method', [('/status', 'get'), ('/start', 'post'), ('/poll', 'post'),
    ('/backup', 'post'), ('/files', 'get'), ('/files/file_1/download', 'get'), ('/disconnect', 'post'), ('/cancel', 'post')])
def test_authenticated_routes(setup, path, method):
    client, _, _, requests, _ = setup
    assert getattr(client, method)('/api/google-drive' + path).status_code == 401
    assert requests == []


def test_expiry_denial_cancellation_and_disconnect(setup):
    client, db, _, requests, _ = setup
    flow, state = start(client)
    row = db.get(drive.GoogleDriveOAuthAttempt, flow['flow_id'])
    row.expires_at = utc_now() - timedelta(seconds=1)
    db.commit()
    assert client.get('/api/google-drive/callback', params={'state': state, 'code': 'code'}).status_code == 400
    assert client.post('/api/google-drive/poll', headers=HEADERS, json={k: flow[k] for k in ('flow_id', 'poll_secret')}).json()['status'] == 'expired'
    flow, state = start(client)
    assert client.get('/api/google-drive/callback', params={'state': state, 'error': 'access_denied'}).status_code == 200
    assert client.post('/api/google-drive/poll', headers=HEADERS, json={k: flow[k] for k in ('flow_id', 'poll_secret')}).json()['status'] == 'failed'
    connect(client)
    _, state = start(client)
    assert client.post('/api/google-drive/disconnect', headers=HEADERS).json() == {'connected': False}
    assert db.get(drive.GoogleDriveConnection, 1).refresh_token is None
    assert client.get('/api/google-drive/callback', params={'state': state, 'code': 'code'}).status_code == 400
    assert client.post('/api/google-drive/backup', headers=HEADERS).status_code == 409
    assert len(requests) == 2
    assert str(requests[-1].url) == 'https://oauth2.googleapis.com/revoke'
    assert parse_qs(requests[-1].content.decode()) == {'token': ['refresh-secret']}


def test_config_fail_closed_and_account_deletion(setup, monkeypatch):
    client, db, _, _, _ = setup
    connect(client)
    monkeypatch.delenv('GOOGLE_DRIVE_ENCRYPTION_KEY')
    assert client.post('/api/google-drive/start', headers=HEADERS).status_code == 503
    assert client.post('/api/google-drive/backup', headers=HEADERS).status_code == 503
    db.delete(db.get(User, 1))
    db.commit()
    db.expire_all()
    assert db.query(drive.GoogleDriveConnection).count() == 0
    assert db.query(drive.GoogleDriveOAuthAttempt).count() == 0


def test_upload_export_is_user_scoped(setup):
    client, db, _, requests, _ = setup
    connect(client)
    result = client.post('/api/google-drive/backup', headers=HEADERS)
    assert result.status_code == 200 and result.json() == {'id': 'file_1'}
    upload = requests[-1]
    assert upload.url.params['uploadType'] == 'multipart'
    assert upload.headers['authorization'] == 'Bearer access-secret'
    assert b'"version":1' in upload.content
    assert b'password_hash' not in upload.content
    assert db.get(drive.GoogleDriveConnection, 1).namespace.encode() in upload.content
    assert client.get('/api/google-drive/files', headers=HEADERS).json() == {'files': [], 'next_page_token': None}
    assert db.get(drive.GoogleDriveConnection, 1).namespace in requests[-1].url.params['q']


def test_status_configuration_cancel_and_rate_limit(setup, monkeypatch):
    client, db, _, requests, _ = setup
    assert client.get('/api/google-drive/status', headers=HEADERS).json() == {'configured': True, 'connected': False}
    flow, state = start(client)
    body = {k: flow[k] for k in ('flow_id', 'poll_secret')}
    assert client.post('/api/google-drive/cancel', headers=OTHER, json=body).status_code == 404
    assert client.post('/api/google-drive/cancel', headers=HEADERS, json=body).json() == {'status': 'cancelled', 'connected': False}
    assert client.get('/api/google-drive/callback', params={'state': state, 'code': 'code'}).status_code == 400
    assert requests == []
    for _ in range(9):
        start(client)
    assert client.post('/api/google-drive/start', headers=HEADERS).status_code == 429
    monkeypatch.setenv('GOOGLE_DRIVE_ENCRYPTION_KEY', 'invalid')
    assert client.get('/api/google-drive/status', headers=HEADERS).json()['configured'] is False


@pytest.mark.parametrize('scope,refresh', [(drive.SCOPE + ' openid', 'refresh'), ('', 'refresh'), (drive.SCOPE, None)])
def test_reject_incomplete_or_excessive_grants(setup, scope, refresh):
    client, db, _, _, set_handler = setup
    flow, state = start(client)
    set_handler(lambda request: httpx.Response(200, json={'scope': scope, 'refresh_token': refresh}))
    assert client.get('/api/google-drive/callback', params={'state': state, 'code': 'code'}).status_code == 200
    assert db.get(drive.GoogleDriveConnection, 1).refresh_token is None
    assert client.post('/api/google-drive/poll', headers=HEADERS, json={k: flow[k] for k in ('flow_id', 'poll_secret')}).json()['status'] == 'failed'


@pytest.mark.parametrize('mode,expected', [('valid', 200), ('foreign', 404), ('metadata_large', 413), ('stream_large', 413)])
def test_download_scope_and_stream_limits(setup, monkeypatch, mode, expected):
    client, db, _, _, set_handler = setup
    connect(client)
    monkeypatch.setattr(drive, 'MAX_BYTES', 8)
    properties = drive.marker(db.get(drive.GoogleDriveConnection, 1))
    def remote(request):
        if str(request.url) == drive.TOKEN_URL:
            return httpx.Response(200, json={'access_token': 'access-secret'})
        if request.url.params.get('alt') == 'media':
            return httpx.Response(200, content=b'123456789' if mode == 'stream_large' else b'{"v":1}')
        return httpx.Response(200, json={'mimeType': 'application/json', 'size': '100' if mode == 'metadata_large' else '7',
            'appProperties': {} if mode == 'foreign' else properties})
    set_handler(remote)
    response = client.get('/api/google-drive/files/file_1/download', headers=HEADERS)
    assert response.status_code == expected
    if expected == 200:
        assert response.content == b'{"v":1}'
        assert response.headers['content-disposition'] == 'attachment; filename="budgetly-backup.json"'
    assert client.get('/api/google-drive/files/file_1/download', headers=OTHER).status_code == 409


def test_upstream_errors_are_sanitized_and_audits_have_no_tokens(setup):
    from api.reliability_models import Activity
    client, db, _, _, set_handler = setup
    connect(client)
    assert client.post('/api/google-drive/backup', headers=HEADERS).status_code == 200
    assert client.post('/api/google-drive/disconnect', headers=HEADERS).status_code == 200
    actions = [row.action for row in db.query(Activity).all()]
    assert actions == ['Connected Google Drive backups', 'Uploaded Google Drive backup', 'Disconnected Google Drive backups']
    connect(client)
    set_handler(lambda request: httpx.Response(400, json={'error_description': 'refresh-secret client-secret'}))
    response = client.post('/api/google-drive/backup', headers=HEADERS)
    assert response.status_code == 502
    assert 'refresh-secret' not in response.text and 'client-secret' not in response.text


def test_cancel_during_token_exchange_does_not_reconnect(setup):
    client, db, _, _, set_handler = setup
    flow, state = start(client)
    def remote(request):
        db.query(drive.GoogleDriveOAuthAttempt).filter_by(id=flow['flow_id']).update({'status': 'cancelled'}, synchronize_session=False)
        db.commit()
        return httpx.Response(200, json={'scope': drive.SCOPE, 'refresh_token': 'refresh-secret'})
    set_handler(remote)
    assert client.get('/api/google-drive/callback', params={'state': state, 'code': 'code'}).status_code == 200
    assert db.get(drive.GoogleDriveConnection, 1).refresh_token is None


def test_revocation_failure_still_clears_local_credentials(setup):
    client, db, _, _, set_handler = setup
    connect(client)
    set_handler(lambda request: httpx.Response(503, text='refresh-secret'))
    response = client.post('/api/google-drive/disconnect', headers=HEADERS)
    assert response.status_code == 502 and 'refresh-secret' not in response.text
    assert db.get(drive.GoogleDriveConnection, 1).refresh_token is None


def test_account_deleted_during_exchange_cannot_recreate_connection(setup):
    client, db, _, _, set_handler = setup
    _, state = start(client)
    def remote(request):
        db.delete(db.get(User, 1))
        db.commit()
        return httpx.Response(200, json={'scope': drive.SCOPE, 'refresh_token': 'refresh-secret'})
    set_handler(remote)
    assert client.get('/api/google-drive/callback', params={'state': state, 'code': 'code'}).status_code == 200
    assert db.query(drive.GoogleDriveConnection).count() == 0


def test_google_response_limit_and_invalid_json_are_sanitized(setup, monkeypatch):
    client, _, _, _, set_handler = setup
    connect(client)
    for content in (b'bad-json', b'x' * (1024 * 1024 + 1)):
        set_handler(lambda request: httpx.Response(200, content=content))
        response = client.get('/api/google-drive/files', headers=HEADERS)
        assert response.status_code == 502
