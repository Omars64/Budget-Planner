"""Optional Drive backups, independent of Google sign-in.

Register router in api.app and migrate both tables before enabling. Configure
GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, GOOGLE_DRIVE_REDIRECT_URI
(the HTTPS /api/google-drive/callback URL), and GOOGLE_DRIVE_ENCRYPTION_KEY
(a Fernet key). Keep the key stable; rotating it requires re-encryption.
Browser and Android callers open authorization_url externally and POST /poll
with flow_id, poll_secret and their app bearer token. No app token goes into
the browser. Use a separate OAuth client from Google sign-in: disconnect revokes
the Drive grant at Google. Existing remote backups are never deleted.
"""
import base64
import hashlib
import json
import os
import re
import secrets
from datetime import timedelta
from urllib.parse import urlencode, urlsplit

import httpx
from cryptography.fernet import Fernet, InvalidToken
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.encoders import jsonable_encoder
from fastapi.responses import HTMLResponse, JSONResponse, Response
from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from pydantic import BaseModel, Field

from .database import Base, get_db
from .index import current_user, export_backup
from .models import User, utc_now
from .account_security import audit, limit

router = APIRouter(prefix='/api/google-drive', tags=['Google Drive backups'])
SCOPE = 'https://www.googleapis.com/auth/drive.file'
TOKEN_URL = 'https://oauth2.googleapis.com/token'
FILES_URL = 'https://www.googleapis.com/drive/v3/files'
MAX_BYTES = 20 * 1024 * 1024
PRIVATE = {'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer'}


class GoogleDriveConnection(Base):
    __tablename__ = 'google_drive_connections'
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), primary_key=True)
    refresh_token = Column(Text, nullable=True)
    namespace = Column(String(64), nullable=False, default=lambda: secrets.token_hex(32))


class GoogleDriveOAuthAttempt(Base):
    __tablename__ = 'google_drive_oauth_attempts'
    id = Column(String(64), primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    state_hash = Column(String(64), nullable=False, unique=True)
    poll_hash = Column(String(64), nullable=False)
    verifier = Column(Text, nullable=True)
    expires_at = Column(DateTime, nullable=False, index=True)
    status = Column(String(20), nullable=False, default='pending')


def configuration():
    values = [os.getenv('GOOGLE_DRIVE_' + name, '').strip() for name in
              ('CLIENT_ID', 'CLIENT_SECRET', 'REDIRECT_URI', 'ENCRYPTION_KEY')]
    try:
        cipher = Fernet(values[3].encode())
        url = urlsplit(values[2])
        if not all(values) or url.scheme != 'https' or not url.netloc or url.username or url.password or url.query or url.fragment or url.path != '/api/google-drive/callback':
            raise ValueError()
    except (ValueError, TypeError):
        raise HTTPException(503, 'Google Drive backups are not configured') from None
    return values[:3], cipher


def private(data):
    return JSONResponse(data, headers=PRIVATE)


async def google_request(method, url, **kwargs):
    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=False) as client:
            async with client.stream(method, url, **kwargs) as response:
                if not response.is_success:
                    raise HTTPException(502, 'Google Drive request failed; reconnect if needed')
                data = bytearray()
                async for chunk in response.aiter_bytes(chunk_size=65536):
                    if len(data) + len(chunk) > 1024 * 1024:
                        raise HTTPException(502, 'Google response is too large')
                    data.extend(chunk)
                return httpx.Response(response.status_code, content=bytes(data))
    except httpx.HTTPError:
        raise HTTPException(502, 'Google Drive is unavailable') from None


def object_json(response):
    try:
        value = response.json()
        if not isinstance(value, dict):
            raise ValueError()
        return value
    except ValueError:
        raise HTTPException(502, 'Invalid Google response') from None


def decrypt(cipher, value):
    try:
        return cipher.decrypt(value.encode()).decode()
    except (InvalidToken, ValueError, UnicodeError):
        raise HTTPException(503, 'Drive credentials cannot be read; reconnect') from None


@router.post('/start')
def start(user: User = Depends(current_user), db: Session = Depends(get_db)):
    (client_id, _, redirect_uri), cipher = configuration()
    limit(db, f'google-drive-start:{user.id}', 10, 3600)
    connection = db.query(GoogleDriveConnection).filter_by(user_id=user.id).with_for_update().first()
    if connection is None:
        try:
            with db.begin_nested():
                connection = GoogleDriveConnection(user_id=user.id)
                db.add(connection)
                db.flush()
        except IntegrityError:
            connection = db.query(GoogleDriveConnection).filter_by(user_id=user.id).with_for_update().one()
    db.query(GoogleDriveOAuthAttempt).filter(
        GoogleDriveOAuthAttempt.user_id == user.id,
        GoogleDriveOAuthAttempt.status.in_(['pending', 'processing']),
    ).update({'status': 'cancelled', 'verifier': None}, synchronize_session=False)
    state, verifier, poll_secret = secrets.token_urlsafe(32), secrets.token_urlsafe(64), secrets.token_urlsafe(32)
    attempt = GoogleDriveOAuthAttempt(id=secrets.token_hex(32), user_id=user.id,
        state_hash=hashlib.sha256(state.encode()).hexdigest(),
        poll_hash=hashlib.sha256(poll_secret.encode()).hexdigest(),
        verifier=cipher.encrypt(verifier.encode()).decode(), expires_at=utc_now() + timedelta(minutes=10))
    db.add(attempt)
    db.commit()
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
    return private({'flow_id': attempt.id, 'poll_secret': poll_secret, 'authorization_url': 'https://accounts.google.com/o/oauth2/v2/auth?' + urlencode({
        'client_id': client_id, 'redirect_uri': redirect_uri, 'response_type': 'code',
        'scope': SCOPE, 'access_type': 'offline', 'prompt': 'consent',
        'include_granted_scopes': 'false', 'state': state,
        'code_challenge': challenge, 'code_challenge_method': 'S256'})})


@router.get('/status')
def status(user: User = Depends(current_user), db: Session = Depends(get_db)):
    connection = db.get(GoogleDriveConnection, user.id)
    try:
        configuration()
        configured = True
    except HTTPException:
        configured = False
    result = {'configured': configured, 'connected': bool(connection and connection.refresh_token)}
    return private(result)


class PollIn(BaseModel):
    flow_id: str = Field(min_length=64, max_length=64)
    poll_secret: str = Field(min_length=20, max_length=200)


@router.post('/poll')
def poll(payload: PollIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    attempt = db.query(GoogleDriveOAuthAttempt).filter_by(id=payload.flow_id, user_id=user.id).first()
    if not attempt or not secrets.compare_digest(attempt.poll_hash, hashlib.sha256(payload.poll_secret.encode()).hexdigest()):
        raise HTTPException(404, 'Authorization attempt not found')
    connection = db.get(GoogleDriveConnection, user.id)
    state = 'expired' if attempt.status in ('pending', 'processing') and attempt.expires_at <= utc_now() else attempt.status
    if state == 'processing':
        state = 'pending'
    return private({'status': state, 'connected': bool(connection and connection.refresh_token)})


@router.post('/cancel')
def cancel(payload: PollIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    attempt = db.query(GoogleDriveOAuthAttempt).filter_by(id=payload.flow_id, user_id=user.id).first()
    if not attempt or not secrets.compare_digest(attempt.poll_hash, hashlib.sha256(payload.poll_secret.encode()).hexdigest()):
        raise HTTPException(404, 'Authorization attempt not found')
    db.query(GoogleDriveConnection).filter_by(user_id=user.id).with_for_update().first()
    db.query(GoogleDriveOAuthAttempt).filter_by(id=attempt.id).filter(
        GoogleDriveOAuthAttempt.status.in_(['pending', 'processing'])).update(
        {'status': 'cancelled', 'verifier': None}, synchronize_session=False)
    db.commit()
    return poll(payload, user, db)


@router.get('/callback', response_class=HTMLResponse)
async def callback(state: str = Query(..., min_length=20, max_length=200),
                   code: str | None = Query(None, max_length=4096),
                   error: str | None = Query(None, max_length=200), db: Session = Depends(get_db)):
    (client_id, client_secret, redirect_uri), cipher = configuration()
    digest = hashlib.sha256(state.encode()).hexdigest()
    attempt = db.query(GoogleDriveOAuthAttempt).filter_by(state_hash=digest).first()
    if not attempt or attempt.expires_at <= utc_now():
        raise HTTPException(400, 'Invalid or expired authorization')
    attempt_id, user_id = attempt.id, attempt.user_id
    verifier = attempt.verifier
    claimed = db.query(GoogleDriveOAuthAttempt).filter_by(id=attempt_id, status='pending').filter(
        GoogleDriveOAuthAttempt.expires_at > utc_now()).update(
        {'status': 'processing', 'verifier': None}, synchronize_session=False)
    db.commit()
    if not claimed:
        raise HTTPException(400, 'Authorization already used')
    refresh = None
    if code and not error:
        try:
            tokens = object_json(await google_request('POST', TOKEN_URL, data={
                'client_id': client_id, 'client_secret': client_secret,
                'redirect_uri': redirect_uri, 'grant_type': 'authorization_code',
                'code': code, 'code_verifier': decrypt(cipher, verifier)}))
            # Fail closed if consent omitted Drive or silently combined sign-in scopes.
            if isinstance(tokens.get('scope'), str) and set(tokens['scope'].split()) == {SCOPE} and isinstance(tokens.get('refresh_token'), str) and tokens['refresh_token']:
                refresh = cipher.encrypt(tokens['refresh_token'].encode()).decode()
        except HTTPException:
            pass
    connection = db.query(GoogleDriveConnection).filter_by(user_id=user_id).with_for_update().populate_existing().first()
    if connection is None:
        db.rollback()
        return HTMLResponse('<!doctype html><title>Budgetly</title><p>Authorization ended.</p>', headers=PRIVATE)
    db.refresh(attempt)
    owner = db.get(User, user_id)
    if attempt.status == 'processing' and attempt.expires_at > utc_now() and owner and owner.active:
        if refresh:
            connection.refresh_token = refresh
            audit(db, owner.id, owner.id, 'Connected Google Drive backups', 'google-drive')
        attempt.status = 'connected' if refresh else 'failed'
        db.commit()
    else:
        db.rollback()
    return HTMLResponse('<!doctype html><title>Budgetly</title><p>Authorization finished. Return to Budgetly to check the result.</p>',
        headers={**PRIVATE, 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'"})


@router.post('/disconnect')
async def disconnect(user: User = Depends(current_user), db: Session = Depends(get_db)):
    connection = db.query(GoogleDriveConnection).filter_by(user_id=user.id).with_for_update().first()
    token = None
    credential_error = None
    if connection and connection.refresh_token:
        try:
            _, cipher = configuration()
            token = decrypt(cipher, connection.refresh_token)
        except HTTPException as exc:
            credential_error = exc
    if connection:
        connection.refresh_token = None
    db.query(GoogleDriveOAuthAttempt).filter_by(user_id=user.id).filter(
        GoogleDriveOAuthAttempt.status.in_(['pending', 'processing'])).update(
        {'status': 'cancelled', 'verifier': None}, synchronize_session=False)
    audit(db, user.id, user.id, 'Disconnected Google Drive backups', 'google-drive')
    db.commit()
    if credential_error:
        raise HTTPException(503, 'Disconnected locally; Google revocation could not be completed')
    if token:
        try:
            await google_request('POST', 'https://oauth2.googleapis.com/revoke', data={'token': token})
        except HTTPException:
            raise HTTPException(502, 'Disconnected locally; Google revocation could not be completed') from None
    return private({'connected': False})


async def credentials(user, db):
    (client_id, client_secret, _), cipher = configuration()
    connection = db.get(GoogleDriveConnection, user.id)
    if not connection or not connection.refresh_token:
        raise HTTPException(409, 'Connect Google Drive first')
    tokens = object_json(await google_request('POST', TOKEN_URL, data={
        'client_id': client_id, 'client_secret': client_secret, 'grant_type': 'refresh_token',
        'refresh_token': decrypt(cipher, connection.refresh_token)}))
    token = tokens.get('access_token')
    if not isinstance(token, str) or not token or any(c in token for c in '\r\n'):
        raise HTTPException(502, 'Invalid Google response')
    return connection, {'Authorization': 'Bearer ' + token}


def marker(connection):
    return {'budgetlyBackup': '1', 'budgetlyOwner': connection.namespace}


@router.post('/backup')
async def backup(user: User = Depends(current_user), db: Session = Depends(get_db)):
    limit(db, f'google-drive-upload:{user.id}', 20, 3600)
    connection, headers = await credentials(user, db)
    payload = json.dumps(jsonable_encoder(export_backup(user, db)), separators=(',', ':')).encode()
    if len(payload) > MAX_BYTES:
        raise HTTPException(413, 'Backup is too large')
    name = 'budgetly-' + utc_now().strftime('%Y%m%dT%H%M%S') + '.json'
    boundary = secrets.token_hex(32)
    metadata = json.dumps({'name': name, 'mimeType': 'application/json', 'appProperties': marker(connection)})
    body = (f'--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{metadata}\r\n'
            f'--{boundary}\r\nContent-Type: application/json\r\n\r\n').encode() + payload + f'\r\n--{boundary}--\r\n'.encode()
    result = object_json(await google_request('POST', 'https://www.googleapis.com/upload/drive/v3/files',
        params={'uploadType': 'multipart', 'fields': 'id,name,createdTime,size'},
        headers={**headers, 'Content-Type': 'multipart/related; boundary=' + boundary}, content=body))
    if not isinstance(result.get('id'), str) or not result['id']:
        raise HTTPException(502, 'Invalid Google response')
    audit(db, user.id, user.id, 'Uploaded Google Drive backup', 'google-drive')
    db.commit()
    return private({k: result[k] for k in ('id', 'name', 'createdTime', 'size') if k in result})


@router.get('/files')
async def list_backups(page_token: str | None = Query(None, max_length=2048),
                       user: User = Depends(current_user), db: Session = Depends(get_db)):
    limit(db, f'google-drive-list:{user.id}', 120, 3600)
    connection, headers = await credentials(user, db)
    params = {'q': "trashed = false and mimeType = 'application/json' and " + ' and '.join(
        "appProperties has { key='%s' and value='%s' }" % pair for pair in marker(connection).items()),
        'fields': 'files(id,name,createdTime,size),nextPageToken', 'pageSize': 100, 'orderBy': 'createdTime desc'}
    if page_token:
        params['pageToken'] = page_token
    result = object_json(await google_request('GET', FILES_URL, headers=headers, params=params))
    if not isinstance(result.get('files', []), list) or any(not isinstance(item, dict) for item in result.get('files', [])):
        raise HTTPException(502, 'Invalid Google response')
    return private({'files': [{k: item[k] for k in ('id', 'name', 'createdTime', 'size') if k in item}
                              for item in result.get('files', [])], 'next_page_token': result.get('nextPageToken')})


@router.get('/files/{file_id}/download')
async def download(file_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    limit(db, f'google-drive-download:{user.id}', 60, 3600)
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,200}', file_id):
        raise HTTPException(400, 'Invalid file ID')
    connection, headers = await credentials(user, db)
    metadata = object_json(await google_request('GET', FILES_URL + '/' + file_id, headers=headers,
        params={'fields': 'appProperties,mimeType,trashed,size'}))
    if metadata.get('trashed') or metadata.get('mimeType') != 'application/json' or metadata.get('appProperties') != marker(connection):
        raise HTTPException(404, 'Backup not found')
    try:
        if int(metadata['size']) > MAX_BYTES:
            raise HTTPException(413, 'Backup is too large')
    except (KeyError, ValueError, TypeError):
        raise HTTPException(502, 'Invalid Google response') from None
    # Stream with a hard limit even if the remote metadata is stale or incorrect.
    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=False) as client:
            async with client.stream('GET', FILES_URL + '/' + file_id, headers=headers, params={'alt': 'media'}) as response:
                if not response.is_success:
                    raise HTTPException(502, 'Google Drive download failed')
                data = bytearray()
                async for chunk in response.aiter_bytes(chunk_size=65536):
                    if len(data) + len(chunk) > MAX_BYTES:
                        raise HTTPException(413, 'Backup is too large')
                    data.extend(chunk)
    except httpx.HTTPError:
        raise HTTPException(502, 'Google Drive is unavailable') from None
    return Response(bytes(data), media_type='application/json', headers={**PRIVATE,
        'Content-Disposition': 'attachment; filename="budgetly-backup.json"', 'X-Content-Type-Options': 'nosniff'})
