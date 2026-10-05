import json
import time
from datetime import timedelta
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from api import google_auth as google
from api.account_security import ResetIn, complete_reset
from api.database import Base, get_db
from api.index import current_user, hash_password, verify_password
from api.models import User, utc_now
from api.reliability_models import AccountSession, ResetToken


@pytest.fixture
def env(monkeypatch):
    for key, value in {'GOOGLE_AUTH_ENABLED': 'true', 'GOOGLE_CLIENT_ID': 'client',
                       'GOOGLE_CLIENT_SECRET': 'secret',
                       'GOOGLE_REDIRECT_URI': 'https://budgetly.example/api/auth/google/callback'}.items():
        monkeypatch.setenv(key, value)
    engine = create_engine('sqlite://', poolclass=StaticPool, connect_args={'check_same_thread': False})
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    app = FastAPI()
    app.include_router(google.router)
    def database():
        with factory() as db:
            yield db
    app.dependency_overrides[get_db] = database
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public = key.public_key().public_numbers()
    settings = {'claims': {}, 'bad_signature': False, 'token_error': False, 'calls': [], 'during_exchange': None}
    def provider(request):
        if str(request.url) == google.JWKS_URL:
            return httpx.Response(200, json={'keys': [{'kid': 'key', 'kty': 'RSA',
                'n': google.enc(public.n.to_bytes(256, 'big')), 'e': google.enc(public.e.to_bytes(3, 'big'))}]})
        assert str(request.url) == google.TOKEN_URL
        values = parse_qs(request.content.decode())
        settings['calls'].append(values)
        with factory() as db:
            row = db.query(google.GoogleAuthState).filter_by(verifier=values['code_verifier'][0]).one()
            claims = {'iss': 'https://accounts.google.com', 'aud': 'client', 'sub': 'subject',
                      'email': 'person@example.com', 'email_verified': True, 'nonce': row.nonce,
                      'iat': int(time.time()), 'exp': int(time.time()) + 300, 'auth_time': int(time.time())}
        claims.update(settings['claims'])
        if settings['during_exchange']:
            settings['during_exchange']()
        body = google.enc(json.dumps({'alg': 'RS256', 'kid': 'key'}).encode()) + '.' + google.enc(json.dumps(claims).encode())
        signature = key.sign(body.encode(), padding.PKCS1v15(), hashes.SHA256())
        if settings['bad_signature']:
            signature = bytes(256)
        return httpx.Response(400 if settings['token_error'] else 200, json={'id_token': body + '.' + google.enc(signature)})
    original_client = httpx.Client
    monkeypatch.setattr(google.httpx, 'Client', lambda **kwargs: original_client(
        transport=httpx.MockTransport(provider), **kwargs))
    # TestClient is constructed before patching httpx.Client's name affects provider calls.
    with TestClient(app) as client:
        yield client, factory, settings
    engine.dispose()


def begin(client, **kwargs):
    result = client.post('/api/auth/google/start', **kwargs)
    assert result.status_code == 200, result.text
    flow = result.json()
    query = parse_qs(urlsplit(flow['authorization_url']).query)
    assert query['code_challenge_method'] == ['S256']
    assert 'poll_secret' not in query
    return flow, query


def callback(client, query):
    return client.get('/api/auth/google/callback', params={'state': query['state'][0], 'code': 'code'})


def poll(client, flow):
    return client.post('/api/auth/google/poll', json={'poll_secret': flow['poll_secret']})


def account(factory, password=''):
    with factory() as db:
        user = User(username='Existing', email='person@example.com', password_hash=password)
        db.add(user)
        db.flush()
        session = AccountSession(id='session', user_id=user.id, verified_at=utc_now())
        db.add(session)
        db.commit()
        token = google.auth_serializer.dumps({'user_id': user.id, 'sid': session.id,
            'role': user.role, 'credential': google.digest(password)})
        return user.id, {'Authorization': 'Bearer ' + token}


def test_signup_name_session_replay_and_recovery(env):
    client, factory, settings = env
    flow, query = begin(client)
    assert poll(client, flow).json() == {'status': 'pending'}
    assert callback(client, query).status_code == 200
    assert callback(client, query).status_code == 400
    assert len(settings['calls']) == 1
    assert poll(client, flow).json() == {'status': 'name_required'}
    with factory() as db:
        assert db.query(User).count() == 0
    assert client.post('/api/auth/google/complete-name', json={**{'poll_secret': flow['poll_secret']}, 'preferred_name': '  '}).status_code == 422
    result = client.post('/api/auth/google/complete-name', json={'poll_secret': flow['poll_secret'], 'preferred_name': 'Chosen Name'})
    assert result.status_code == 200, result.text
    data = result.json()
    assert data['user']['signup_provider'] == 'google'
    assert data['user']['has_password'] is False
    token = google.auth_serializer.loads(data['token'])
    with factory() as db:
        user = db.get(User, token['user_id'])
        assert user.username == 'Chosen Name' and user.password_hash == ''
        assert not verify_password('anything', user.password_hash)
        assert db.get(AccountSession, token['sid']).verified_at is None
        db.add(ResetToken(digest=google.digest('recovery-secret-token'), user_id=user.id,
                          expires=utc_now() + timedelta(minutes=5)))
        db.commit()
        complete_reset(ResetIn(token='recovery-secret-token', password='new-password-123'), db)
        assert verify_password('new-password-123', user.password_hash)
        assert db.get(AccountSession, token['sid']).revoked
    assert poll(client, flow).status_code == 400
    flow, query = begin(client)
    callback(client, query)
    assert poll(client, flow).json()['status'] == 'complete'
    assert poll(client, flow).status_code == 400


@pytest.mark.parametrize('claim,value', [('iss', 'attacker'), ('aud', 'other'), ('azp', 'other'),
    ('email_verified', False), ('email_verified', 'true'), ('nonce', 'wrong'), ('sub', ''),
    ('exp', 0), ('exp', float('nan')), ('iat', 99999999999), ('nbf', 99999999999)])
def test_invalid_claims_fail_closed(env, claim, value):
    client, factory, settings = env
    settings['claims'][claim] = value
    flow, query = begin(client)
    callback(client, query)
    assert poll(client, flow).json()['status'] == 'failed'
    with factory() as db:
        assert db.query(User).count() == 0


@pytest.mark.parametrize('failure', ['bad_signature', 'token_error'])
def test_provider_and_signature_failure(env, failure):
    client, _, settings = env
    settings[failure] = True
    flow, query = begin(client)
    callback(client, query)
    assert poll(client, flow).json()['status'] == 'failed'


def test_same_email_requires_explicit_recent_link(env):
    client, factory, _ = env
    uid, headers = account(factory, hash_password('password-123'))
    flow, query = begin(client)
    callback(client, query)
    assert poll(client, flow).json()['status'] == 'link_required'
    assert client.post('/api/auth/google/complete-name', json={'poll_secret': flow['poll_secret'], 'preferred_name': 'Name'}).status_code == 409
    assert client.post('/api/auth/google/link/start').status_code == 401
    with factory() as db:
        db.get(AccountSession, 'session').verified_at = None
        db.commit()
    assert client.post('/api/auth/google/link/start', headers=headers).status_code == 428
    with factory() as db:
        db.get(AccountSession, 'session').verified_at = utc_now()
        db.commit()
    flow, query = begin(client, headers=headers, json={'mode': 'link'})
    callback(client, query)
    assert poll(client, flow).json() == {'status': 'linked'}
    with factory() as db:
        assert db.get(google.GoogleIdentity, 'subject').user_id == uid
        assert google.google_account_payload(db.get(User, uid))['signup_provider'] == 'password'


@pytest.mark.parametrize('failure', ['wrong_subject', 'stale_auth', 'revoked', 'none'])
def test_reauth_confirms_only_initiating_session(env, failure):
    client, factory, settings = env
    uid, headers = account(factory)
    with factory() as db:
        db.add(google.GoogleIdentity(subject='subject', user_id=uid, email='person@example.com', signup=True))
        db.get(AccountSession, 'session').verified_at = None
        db.commit()
    flow, query = begin(client, headers=headers, json={'mode': 'reauth'})
    assert query['max_age'] == ['0']
    assert json.loads(query['claims'][0]) == {'id_token': {'auth_time': {'essential': True}}}
    if failure == 'wrong_subject':
        settings['claims']['sub'] = 'other'
    if failure == 'stale_auth':
        settings['claims']['auth_time'] = int(time.time()) - 600
    if failure == 'revoked':
        with factory() as db:
            db.get(AccountSession, 'session').revoked = True
            db.commit()
    callback(client, query)
    assert poll(client, flow).json()['status'] == ('reauthenticated' if failure == 'none' else 'failed')
    with factory() as db:
        assert (db.get(AccountSession, 'session').verified_at is not None) == (failure == 'none')


def test_disabled_expiry_and_wrong_poll_secret(env, monkeypatch):
    client, factory, _ = env
    flow, query = begin(client)
    assert client.post('/api/auth/google/poll', json={'poll_secret': 'x' * 43}).status_code == 400
    with factory() as db:
        db.query(google.GoogleAuthState).update({'expires_at': utc_now() - timedelta(seconds=1)})
        db.commit()
    assert callback(client, query).status_code == 400
    assert poll(client, flow).status_code == 400
    monkeypatch.setenv('GOOGLE_AUTH_ENABLED', 'false')
    assert client.get('/api/auth/google/config').json() == {'enabled': False}
    assert client.post('/api/auth/google/start').status_code == 503


@pytest.mark.parametrize('phase', ['before_callback', 'during_exchange', 'after_callback'])
def test_cancel_prevents_late_signup_and_callback(env, phase):
    client, factory, settings = env
    flow, query = begin(client)
    def cancel():
        result = client.post('/api/auth/google/cancel', json={'poll_secret': flow['poll_secret']})
        assert result.json() == {'status': 'cancelled'}
    if phase == 'before_callback':
        cancel()
        assert callback(client, query).status_code == 400
    else:
        if phase == 'during_exchange':
            settings['during_exchange'] = cancel
        assert callback(client, query).status_code == 200
        if phase == 'after_callback':
            cancel()
    assert poll(client, flow).json()['status'] == 'cancelled'
    assert client.post('/api/auth/google/cancel', json={'poll_secret': flow['poll_secret']}).status_code == 409
    assert client.post('/api/auth/google/complete-name', json={'poll_secret': flow['poll_secret'], 'preferred_name': 'Name'}).status_code == 409
    with factory() as db:
        assert db.query(User).count() == 0
        assert db.query(google.GoogleIdentity).count() == 0


def test_link_revocation_during_exchange(env):
    client, factory, settings = env
    _, headers = account(factory, hash_password('password-123'))
    flow, query = begin(client, headers=headers, json={'mode': 'link'})
    def revoke():
        with factory() as db:
            db.get(AccountSession, 'session').revoked = True
            db.commit()
    settings['during_exchange'] = revoke
    callback(client, query)
    assert poll(client, flow).json()['status'] == 'failed'
    with factory() as db:
        assert db.query(google.GoogleIdentity).count() == 0


@pytest.mark.parametrize('mode', ['link', 'reauth'])
def test_cancellation_during_exchange_prevents_account_side_effects(env, mode):
    client, factory, settings = env
    uid, headers = account(factory, hash_password('password-123'))
    with factory() as db:
        if mode == 'reauth':
            db.add(google.GoogleIdentity(subject='subject', user_id=uid, email='person@example.com'))
            db.get(AccountSession, 'session').verified_at = None
            db.commit()
    flow, query = begin(client, headers=headers, json={'mode': mode})
    def cancel():
        result = client.post('/api/auth/google/cancel', json={'poll_secret': flow['poll_secret']})
        assert result.status_code == 200
    settings['during_exchange'] = cancel
    assert callback(client, query).status_code == 200
    assert poll(client, flow).json()['status'] == 'cancelled'
    with factory() as db:
        assert db.query(google.GoogleIdentity).count() == (1 if mode == 'reauth' else 0)
        if mode == 'reauth':
            assert db.get(AccountSession, 'session').verified_at is None
        assert db.query(User).count() == 1


def test_detached_serializer_requires_explicit_session(env):
    _, factory, _ = env
    uid, _ = account(factory)
    with factory() as db:
        user = db.get(User, uid)
        db.expunge(user)
        with pytest.raises(ValueError, match='attached user'):
            google.google_account_payload(user)
        assert google.google_account_payload(user, db) == {
            'google_linked': False, 'signup_provider': 'password', 'has_password': False}
