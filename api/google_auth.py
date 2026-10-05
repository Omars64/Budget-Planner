"""External-browser Google authentication; no provider tokens leave this module.

Integration: include router in api.app, import this module before schema discovery,
and migrate GoogleIdentity/GoogleAuthState tables (including unique constraints).
Expose google_account_payload(db, user) in the usual user serializer for logo and
password availability. Exclude both tables from workspace backup/restore; account
deletion must delete their rows even on SQLite without foreign-key enforcement.
Recovery may set a password through account_security.complete_reset, which already
accepts the empty sentinel. Never restore identities or OAuth state from backups.
"""
import base64
import hashlib
import hmac
import json
import math
import os
import secrets
import time
from datetime import timedelta
from urllib.parse import urlencode, urlsplit

import httpx
from cryptography.hazmat.primitives import hashes
from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import object_session
from typing import Literal
from sqlalchemy.exc import IntegrityError

from .database import Base, get_db
from .models import User, utc_now
from .reliability_models import AccountSession
from .index import APP_SECRET, auth_serializer, current_user, user_payload, seed_user_workspace
from .account_security import audit, confirmed, limit

router = APIRouter(prefix='/api/auth/google', tags=['Google authentication'])
AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
TOKEN_URL = 'https://oauth2.googleapis.com/token'
JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs'
TTL = 600


class GoogleRevocationCredential(Base):
    __tablename__ = 'google_revocation_credentials'
    subject = Column(String(255), primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=True, index=True)
    token = Column(Text, nullable=False)
    expires_at = Column(DateTime, nullable=True)


def revocation_cipher():
    # Domain-separated key; APP_SECRET is already required to be strong in production.
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(
        ('budgetly-google-revocation-v1:' + APP_SECRET).encode()).digest()))


def revoke_google_access(db, user_id):
    """Fail closed before deleting records: never discard a grant we could not revoke."""
    from .google_drive import GoogleDriveConnection, configuration as drive_configuration, decrypt
    identity = db.query(GoogleIdentity).filter_by(user_id=user_id).first()
    credential = db.query(GoogleRevocationCredential).filter_by(user_id=user_id).first()
    tokens = []
    if identity and not credential:
        raise HTTPException(409, 'Google permission needs confirmation before deletion. Sign in with Google again, or remove Budgetly at https://myaccount.google.com/connections and reconnect Google before retrying.')
    try:
        if credential:
            tokens.append(revocation_cipher().decrypt(credential.token.encode()).decode())
        connection = db.get(GoogleDriveConnection, user_id)
        if connection and connection.refresh_token:
            _, cipher = drive_configuration()
            tokens.append(decrypt(cipher, connection.refresh_token))
    except (InvalidToken, ValueError):
        raise HTTPException(503, 'Google permission could not be read. Account was not deleted.') from None
    try:
        with httpx.Client(timeout=10, follow_redirects=False, trust_env=False) as http:
            for token in tokens:
                response = http.post('https://oauth2.googleapis.com/revoke', data={'token': token})
                # Google reports invalid_token for grants already removed externally.
                if response.status_code == 400 and response.json().get('error') == 'invalid_token':
                    continue
                response.raise_for_status()
    except (httpx.HTTPError, ValueError):
        raise HTTPException(502, 'Google permission could not be removed. Account was not deleted; try again shortly.') from None


class GoogleIdentity(Base):
    __tablename__ = 'google_identities'
    subject = Column(String(255), primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False, unique=True)
    email = Column(String(160), nullable=False)
    signup = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, nullable=False, default=utc_now)


class GoogleAuthState(Base):
    __tablename__ = 'google_auth_states'
    __table_args__ = (UniqueConstraint('poll_digest', name='uq_google_poll_digest'),)
    digest = Column(String(64), primary_key=True)
    poll_digest = Column(String(64), nullable=False)
    nonce = Column(String(64), nullable=False)
    verifier = Column(String(128), nullable=False)
    client_id = Column(String(255), nullable=False)
    redirect_uri = Column(Text, nullable=False)
    expires_at = Column(DateTime, nullable=False, index=True)
    status = Column(String(24), nullable=False, default='pending')
    mode = Column(String(16), nullable=False, default='signin')
    subject = Column(String(255), nullable=True)
    email = Column(String(160), nullable=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=True)
    link_session_id = Column(String(64), nullable=True)
    credential = Column(String(64), nullable=True)


class PollIn(BaseModel):
    poll_secret: str = Field(min_length=40, max_length=100)


class StartIn(BaseModel):
    mode: Literal['signin', 'link', 'reauth'] = 'signin'


class CompleteIn(PollIn):
    preferred_name: str = Field(min_length=1, max_length=80)


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def enc(value):
    return base64.urlsafe_b64encode(value).decode().rstrip('=')


def configuration():
    client = os.getenv('GOOGLE_CLIENT_ID', '').strip()
    secret = os.getenv('GOOGLE_CLIENT_SECRET', '').strip()
    redirect = os.getenv('GOOGLE_REDIRECT_URI', '').strip()
    parsed = urlsplit(redirect)
    if (os.getenv('GOOGLE_AUTH_ENABLED') != 'true' or not client or not secret
            or parsed.scheme != 'https' or not parsed.hostname or parsed.username
            or parsed.password or parsed.query or parsed.fragment
            or parsed.path != '/api/auth/google/callback'):
        raise HTTPException(503, 'Google sign-in is unavailable')
    return client, secret, redirect


def google_account_payload(user, db=None):
    db = db or object_session(user)
    if db is None:
        raise ValueError('Google serialization requires an attached user or database session')
    identity = db.query(GoogleIdentity).filter_by(user_id=user.id).first()
    return {'google_linked': identity is not None, 'signup_provider': 'google' if identity and identity.signup else 'password',
            'has_password': bool(user.password_hash)}


def start_flow(request, db, user=None, mode='signin'):
    client, _, redirect = configuration()
    limit(db, 'google-start:' + (request.client.host if request.client else 'unknown'), 20)
    if mode == 'link':
        confirmed(request, db, user)
    if mode == 'reauth' and not db.query(GoogleIdentity).filter_by(user_id=user.id).first():
        raise HTTPException(409, 'Link Google before using Google confirmation')
    state, poll, nonce, verifier = [secrets.token_urlsafe(32) for _ in range(4)]
    db.query(GoogleRevocationCredential).filter(
        GoogleRevocationCredential.user_id.is_(None), GoogleRevocationCredential.expires_at <= utc_now()
    ).delete(synchronize_session=False)
    db.add(GoogleAuthState(digest=digest(state), poll_digest=digest(poll), nonce=nonce,
                          verifier=verifier, client_id=client, redirect_uri=redirect,
                          expires_at=utc_now() + timedelta(seconds=TTL),
                          mode=mode,
                          user_id=user.id if user else None,
                          link_session_id=request.state.session_id if user else None,
                          credential=digest(user.password_hash) if user else None))
    db.commit()
    return {'authorization_url': AUTHORIZE_URL + '?' + urlencode({
        'client_id': client, 'redirect_uri': redirect, 'response_type': 'code',
        'scope': 'openid email profile', 'state': state, 'nonce': nonce,
        'code_challenge': enc(hashlib.sha256(verifier.encode()).digest()),
        'code_challenge_method': 'S256', 'prompt': 'select_account consent', 'access_type': 'offline',
        **({'max_age': '0', 'claims': json.dumps({'id_token': {'auth_time': {'essential': True}}}, separators=(',', ':'))} if mode == 'reauth' else {})}),
        'poll_secret': poll, 'expires_in': TTL}


@router.post('/start')
def start(request: Request, response: Response, payload: StartIn = StartIn(), db=Depends(get_db)):
    response.headers['Cache-Control'] = 'no-store'
    user = current_user(request, db) if payload.mode != 'signin' else None
    return start_flow(request, db, user, payload.mode)


@router.get('/config')
def config(response: Response):
    response.headers['Cache-Control'] = 'no-store'
    try:
        configuration()
        return {'enabled': True}
    except HTTPException:
        return {'enabled': False}


@router.post('/link/start')
def link_start(request: Request, response: Response, user=Depends(current_user), db=Depends(get_db)):
    response.headers['Cache-Control'] = 'no-store'
    return start_flow(request, db, user, 'link')


@router.post('/reauth/start')
def reauth_start(request: Request, response: Response, user=Depends(current_user), db=Depends(get_db)):
    response.headers['Cache-Control'] = 'no-store'
    return start_flow(request, db, user, 'reauth')


def decode(segment):
    return base64.b64decode(segment + '=' * (-len(segment) % 4), altchars=b'-_', validate=True)


def verify_id_token(token, client_id, nonce, http):
    """Authenticate RS256 with Google's HTTPS JWKS before trusting any claims."""
    try:
        if not isinstance(token, str) or len(token) > 16384:
            raise ValueError()
        header64, body64, signature64 = token.split('.')
        header = json.loads(decode(header64))
        if header.get('alg') != 'RS256' or not isinstance(header.get('kid'), str) or header.get('crit'):
            raise ValueError()
        response = http.get(JWKS_URL)
        response.raise_for_status()
        keys = response.json()['keys']
        key = next(k for k in keys if k.get('kid') == header['kid'] and k.get('kty') == 'RSA'
                   and k.get('use', 'sig') == 'sig' and k.get('alg', 'RS256') == 'RS256')
        public = rsa.RSAPublicNumbers(int.from_bytes(decode(key['e']), 'big'),
                                     int.from_bytes(decode(key['n']), 'big')).public_key()
        public.verify(decode(signature64), (header64 + '.' + body64).encode(),
                      padding.PKCS1v15(), hashes.SHA256())
        claims = json.loads(decode(body64))
        now = time.time()
        audience = claims.get('aud')
        if (claims.get('iss') not in ('accounts.google.com', 'https://accounts.google.com')
                or not (audience == client_id or isinstance(audience, list) and client_id in audience)
                or (isinstance(audience, list) and len(audience) > 1 and claims.get('azp') != client_id)
                or ('azp' in claims and claims['azp'] != client_id)
                or type(claims.get('exp')) not in (int, float) or not math.isfinite(claims['exp']) or claims['exp'] <= now
                or type(claims.get('iat')) not in (int, float) or not math.isfinite(claims['iat']) or claims['iat'] > now + 60
                or ('nbf' in claims and (type(claims['nbf']) not in (int, float) or claims['nbf'] > now))
                or claims.get('email_verified') is not True
                or not isinstance(claims.get('sub'), str) or not 1 <= len(claims['sub']) <= 255
                or not isinstance(claims.get('email'), str) or not 5 <= len(claims['email']) <= 160
                or '@' not in claims['email']
                or not isinstance(claims.get('nonce'), str) or not hmac.compare_digest(claims['nonce'], nonce)):
            raise ValueError()
        return claims
    except Exception as exc:
        raise HTTPException(401, 'Google identity could not be verified') from exc


def link_account(db, row, identity):
    user = db.get(User, row.user_id)
    session = db.get(AccountSession, row.link_session_id)
    if (not user or not user.active or not session or session.revoked or session.user_id != user.id
            or session.created_at <= utc_now() - timedelta(days=1)
            or not session.verified_at or session.verified_at < utc_now() - timedelta(minutes=5)
            or not hmac.compare_digest(row.credential, digest(user.password_hash))):
        raise HTTPException(428, 'Confirm your account again before linking Google')
    if identity and identity.user_id != user.id:
        raise HTTPException(409, 'Google identity is already linked')
    other = db.query(User).filter(func.lower(User.email) == row.email, User.id != user.id).first()
    existing = db.query(GoogleIdentity).filter_by(user_id=user.id).first()
    if other or (existing and existing.subject != row.subject):
        raise HTTPException(409, 'Account cannot be linked')
    if not identity:
        db.add(GoogleIdentity(subject=row.subject, user_id=user.id, email=row.email))
    audit(db, user.id, user.id, 'Linked Google sign-in')
    row.status = 'linked'


@router.get('/callback', response_class=HTMLResponse)
def callback(state: str, code: str = '', error: str = '', db=Depends(get_db)):
    client_id, client_secret, redirect = configuration()
    if len(state) > 100 or len(code) > 4096:
        raise HTTPException(400, 'Invalid Google callback')
    # Conditional UPDATE is the claim: SQLite and PostgreSQL both prevent replay.
    changed = db.query(GoogleAuthState).filter_by(digest=digest(state), status='pending').filter(
        GoogleAuthState.expires_at > utc_now(), GoogleAuthState.client_id == client_id,
        GoogleAuthState.redirect_uri == redirect).update({'status': 'exchanging'}, synchronize_session=False)
    db.commit()
    if changed != 1:
        raise HTTPException(400, 'Google sign-in expired or already used')
    row = db.get(GoogleAuthState, digest(state))
    state_digest = row.digest
    verifier, nonce = row.verifier, row.nonce
    db.commit()
    try:
        if error or not code:
            raise HTTPException(400, 'Google sign-in cancelled')
        with httpx.Client(timeout=10, follow_redirects=False, trust_env=False) as http:
            response = http.post(TOKEN_URL, data={'code': code, 'client_id': client_id,
                'client_secret': client_secret, 'redirect_uri': redirect,
                'grant_type': 'authorization_code', 'code_verifier': verifier})
            response.raise_for_status()
            tokens = response.json()
            claims = verify_id_token(tokens.get('id_token'), client_id, nonce, http)
        # Keep this write lock through all side effects and the final commit.
        # A cancellation that commits first makes the claim fail, even if the
        # identity map still contains an older copy of the OAuth state.
        changed = db.query(GoogleAuthState).filter_by(digest=state_digest, status='exchanging').filter(
            GoogleAuthState.expires_at > utc_now()).update(
            {'status': 'processing'}, synchronize_session='fetch')
        if changed != 1:
            db.rollback()
            return HTMLResponse('<p>Return to Budgetly.</p>', headers={'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer'})
        db.refresh(row)
        row.subject, row.email = claims['sub'], claims['email'].strip().lower()
        identity = db.get(GoogleIdentity, row.subject)
        if row.mode == 'reauth':
            session = db.get(AccountSession, row.link_session_id)
            user = db.get(User, row.user_id)
            auth_time = claims.get('auth_time')
            started = row.expires_at - timedelta(seconds=TTL)
            from datetime import timezone
            if (not identity or identity.user_id != row.user_id or not user or not user.active
                    or not session or session.revoked or session.user_id != user.id
                    or session.created_at <= utc_now() - timedelta(days=1)
                    or not hmac.compare_digest(row.credential, digest(user.password_hash))
                    or type(auth_time) not in (int, float) or not math.isfinite(auth_time)
                    or auth_time < started.replace(tzinfo=timezone.utc).timestamp() - 5
                    or auth_time > time.time() + 60):
                raise HTTPException(401, 'Fresh Google confirmation required')
            session.verified_at = utc_now()
            audit(db, user.id, user.id, 'Confirmed account with Google')
            row.status = 'reauthenticated'
        elif row.link_session_id:
            link_account(db, row, identity)
        elif identity:
            user = db.get(User, identity.user_id)
            if not user or not user.active:
                raise HTTPException(403, 'Account unavailable')
            row.user_id, row.status = user.id, 'ready'
        elif db.query(User).filter(func.lower(User.email) == row.email).first():
            row.status = 'link_required'
        else:
            row.status = 'name_required'
        token = tokens.get('refresh_token')
        if row.status in ('ready', 'linked', 'reauthenticated', 'name_required') and isinstance(token, str) and token:
            grant = db.get(GoogleRevocationCredential, row.subject)
            if grant is None:
                grant = GoogleRevocationCredential(subject=row.subject)
                db.add(grant)
            grant.user_id = row.user_id
            grant.token = revocation_cipher().encrypt(token.encode()).decode()
            grant.expires_at = row.expires_at if row.user_id is None else None
        row.verifier = ''
        db.commit()
    except Exception:
        db.rollback()
        db.query(GoogleAuthState).filter_by(digest=digest(state), status='exchanging').update({'status': 'failed', 'verifier': ''})
        db.commit()
    return HTMLResponse('<!doctype html><title>Budgetly</title><h1>Return to Budgetly</h1><p>Return to the app to see your sign-in result. If you are creating a new account, enter your preferred name and tap Create Google account in Budgetly to finish.</p>',
                        headers={'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
                                 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'"})


def poll_row(db, secret):
    configuration()
    row = db.query(GoogleAuthState).filter_by(poll_digest=digest(secret)).first()
    if not row or row.expires_at <= utc_now() or row.status == 'consumed':
        raise HTTPException(400, 'Google sign-in expired or already used')
    return row


def session_result(db, row, expected):
    changed = db.query(GoogleAuthState).filter_by(digest=row.digest, status=expected).filter(
        GoogleAuthState.expires_at > utc_now()).update({'status': 'consumed'}, synchronize_session=False)
    if changed != 1:
        db.rollback()
        raise HTTPException(400, 'Google sign-in expired or already used')
    user = db.get(User, row.user_id)
    if not user or not user.active:
        db.rollback()
        raise HTTPException(403, 'Account unavailable')
    sid = secrets.token_urlsafe(32)
    db.add(AccountSession(id=sid, user_id=user.id, verified_at=None))
    from .workspace import count_feedback_event
    count_feedback_event(db, user.id)
    audit(db, user.id, user.id, 'Signed in with Google')
    token = auth_serializer.dumps({'user_id': user.id, 'sid': sid, 'role': user.role,
                                   'credential': digest(user.password_hash)})
    result = {'status': 'complete', 'token': token,
              'user': {**user_payload(user), **google_account_payload(user, db)}}
    db.commit()
    return result


@router.post('/poll')
def poll(payload: PollIn, request: Request, response: Response, db=Depends(get_db)):
    response.headers['Cache-Control'] = 'no-store'
    configuration()
    limit(db, 'google-poll:' + (request.client.host if request.client else 'unknown'), 600, 60)
    row = poll_row(db, payload.poll_secret)
    if row.status == 'ready':
        return session_result(db, row, 'ready')
    if row.status in ('linked', 'reauthenticated'):
        status = row.status
        changed = db.query(GoogleAuthState).filter_by(digest=row.digest, status=status).update(
            {'status': 'consumed'}, synchronize_session=False)
        db.commit()
        if changed != 1:
            raise HTTPException(400, 'Google sign-in already used')
        return {'status': status}
    status = row.status if row.status != 'exchanging' else 'pending'
    if status == 'failed':
        return {'status': status, 'message': 'Google sign-in could not be completed. Start again.'}
    if status == 'link_required':
        return {'status': status, 'message': 'Sign in to your existing Budgetly account, confirm it, then link Google in Account security.'}
    return {'status': status}


@router.post('/cancel')
def cancel(payload: PollIn, response: Response, db=Depends(get_db)):
    response.headers['Cache-Control'] = 'no-store'
    row = poll_row(db, payload.poll_secret)
    changed = db.query(GoogleAuthState).filter_by(digest=row.digest).filter(
        GoogleAuthState.status.in_(['pending', 'exchanging', 'name_required', 'ready', 'failed', 'link_required'])
    ).update({'status': 'cancelled', 'verifier': ''}, synchronize_session=False)
    db.commit()
    if changed != 1:
        raise HTTPException(409, 'Google flow already ended')
    return {'status': 'cancelled'}


@router.post('/complete')
@router.post('/complete-name')
def complete(payload: CompleteIn, request: Request, response: Response, db=Depends(get_db)):
    response.headers['Cache-Control'] = 'no-store'
    configuration()
    limit(db, 'google-create:' + (request.client.host if request.client else 'unknown'), 10, 3600)
    name = payload.preferred_name.strip()
    if not name or any(ord(c) < 32 for c in name):
        raise HTTPException(422, 'Enter a preferred name')
    row = poll_row(db, payload.poll_secret)
    changed = db.query(GoogleAuthState).filter_by(digest=row.digest, status='name_required').filter(
        GoogleAuthState.expires_at > utc_now()).update({'status': 'creating'}, synchronize_session=False)
    if changed != 1:
        db.rollback()
        raise HTTPException(409, 'Google signup is not awaiting a name')
    try:
        if db.query(User).filter(func.lower(User.email) == row.email).first():
            raise HTTPException(409, 'Sign in to the existing account and explicitly link Google')
        user = User(username=name, email=row.email, password_hash='', role='user', active=True)
        db.add(user)
        db.flush()
        db.add(GoogleIdentity(subject=row.subject, user_id=user.id, email=row.email, signup=True))
        seed_user_workspace(db, user.id, commit=False)
        row.user_id = user.id
        grant = db.get(GoogleRevocationCredential, row.subject)
        if grant:
            grant.user_id = user.id
            grant.expires_at = None
        db.flush()
        return session_result(db, row, 'creating')
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, 'Account or Google identity already exists; start again') from exc
    except HTTPException:
        db.rollback()
        raise
