"""Opt-in update-only delivery. No financial data is sent to push providers."""
import base64
import json
import os
import re
import time
from datetime import timedelta
from urllib.parse import urlsplit
from uuid import UUID

from cryptography.fernet import Fernet
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import Column, DateTime, ForeignKey, String, Text
from .database import Base, get_db
from .index import current_user
from .models import User, utc_now
from ._version import VERSION

router = APIRouter()
PUSH_HOSTS = {'fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com', 'wns2-db5p.notify.windows.com'}


class UpdatePushDevice(Base):
    __tablename__ = 'update_push_devices'
    id = Column(String(36), primary_key=True)
    user_id = Column(ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    platform = Column(String(10), nullable=False)
    payload = Column(Text, nullable=False)
    installed_version = Column(String(30), nullable=False)
    last_version = Column(String(30), nullable=True)
    updated_at = Column(DateTime, nullable=False, default=utc_now)


def configured():
    return {'browser': all(os.getenv(key) for key in ('WEB_PUSH_PUBLIC_KEY', 'WEB_PUSH_PRIVATE_KEY', 'WEB_PUSH_SUBJECT', 'UPDATE_PUSH_ENCRYPTION_KEY')),
            'android': all(os.getenv(key) for key in ('FIREBASE_SERVICE_ACCOUNT_JSON', 'UPDATE_PUSH_ENCRYPTION_KEY'))}


def cipher():
    return Fernet(os.environ['UPDATE_PUSH_ENCRYPTION_KEY'].encode())


@router.get('/api/app-updates/push-config')
def push_config(response: Response):
    response.headers['Cache-Control'] = 'no-store'
    ready = configured()
    return {**ready, 'public_key': os.getenv('WEB_PUSH_PUBLIC_KEY', '') if ready['browser'] else ''}


class PushIn(BaseModel):
    id: UUID
    platform: str = Field(pattern='^(android|browser)$')
    version: str = Field(pattern=r'^\d{1,6}\.\d{1,6}\.\d{1,6}$')
    token: str | None = Field(default=None, min_length=20, max_length=4096, pattern=r'^[A-Za-z0-9_:\-]+$')
    subscription: dict | None = None

    @field_validator('subscription')
    @classmethod
    def safe_subscription(cls, value):
        if value is None:
            return value
        if len(json.dumps(value)) > 8192:
            raise ValueError('Subscription is too large')
        url = urlsplit(value.get('endpoint', ''))
        host = url.hostname or ''
        if (url.scheme != 'https' or url.username or url.password or url.port not in (None, 443)
                or url.fragment or not (host in PUSH_HOSTS or host.endswith('.notify.windows.com'))):
            raise ValueError('Unsupported push endpoint')
        keys = value.get('keys', {})
        for key, size in [('p256dh', 65), ('auth', 16)]:
            encoded = keys.get(key, '')
            if not isinstance(encoded, str) or not re.fullmatch(r'[A-Za-z0-9_-]+={0,2}', encoded):
                raise ValueError('Invalid subscription key')
            if len(base64.urlsafe_b64decode(encoded + '=' * (-len(encoded) % 4))) != size:
                raise ValueError('Invalid subscription key')
        return {'endpoint': url.geturl(), 'keys': keys}


@router.put('/api/app-updates/push-device')
def subscribe(payload: PushIn, user=Depends(current_user), db=Depends(get_db)):
    if not configured()[payload.platform]:
        raise HTTPException(503, 'Closed-app update alerts are not configured yet. In-app checks remain available.')
    if (payload.platform == 'android' and not payload.token) or (payload.platform == 'browser' and not payload.subscription):
        raise HTTPException(422, 'Missing push subscription')
    db.query(User).filter_by(id=user.id).with_for_update().first()
    row = db.get(UpdatePushDevice, str(payload.id))
    if row and row.user_id != user.id:
        raise HTTPException(404, 'Device not found')
    if not row:
        if db.query(UpdatePushDevice).filter_by(user_id=user.id).count() >= 10:
            raise HTTPException(409, 'This account already has ten push devices.')
        row = UpdatePushDevice(id=str(payload.id), user_id=user.id)
        db.add(row)
    row.platform = payload.platform
    row.payload = cipher().encrypt(json.dumps(payload.token if payload.platform == 'android' else payload.subscription).encode()).decode()
    row.installed_version = payload.version
    row.updated_at = utc_now()
    db.commit()
    return {'enabled': True}


@router.delete('/api/app-updates/push-device/{device_id}', status_code=204)
def unsubscribe(device_id: UUID, user=Depends(current_user), db=Depends(get_db)):
    db.query(UpdatePushDevice).filter_by(id=str(device_id), user_id=user.id).delete()
    db.commit()


def newer(left, right):
    return tuple(map(int, left.split('.'))) > tuple(map(int, right.split('.')))


def send_device(row, version):
    value = json.loads(cipher().decrypt(row.payload.encode()))
    title = f'Budgetly {version} is available'
    body = 'Open Budgetly to review the latest update.'
    if row.platform == 'browser':
        from pywebpush import webpush, WebPushException
        from py_vapid import Vapid
        private_key = os.environ['WEB_PUSH_PRIVATE_KEY'].replace('\\n', '\n')
        vapid = Vapid.from_pem(private_key.encode()) if '-----BEGIN' in private_key else Vapid.from_string(private_key)
        try:
            webpush(value, json.dumps({'version': version, 'title': title, 'body': body}),
                    vapid_private_key=vapid,
                    vapid_claims={'sub': os.environ['WEB_PUSH_SUBJECT']}, ttl=86400, timeout=5)
            return 200
        except WebPushException as error:
            return error.response.status_code if error.response is not None else 503
    from google.oauth2 import service_account
    from google.auth.transport.requests import Request as GoogleRequest
    import httpx
    credentials = service_account.Credentials.from_service_account_info(
        json.loads(os.environ['FIREBASE_SERVICE_ACCOUNT_JSON']), scopes=['https://www.googleapis.com/auth/firebase.messaging'])
    transport = GoogleRequest()
    def bounded_request(*args, **kwargs):
        kwargs['timeout'] = 5
        return transport(*args, **kwargs)
    credentials.refresh(bounded_request)
    project = credentials.project_id
    if not re.fullmatch(r'[a-z][a-z0-9-]{4,62}', project or ''):
        raise ValueError('Invalid Firebase project')
    with httpx.Client(timeout=5, follow_redirects=False) as client:
        result = client.post(f'https://fcm.googleapis.com/v1/projects/{project}/messages:send',
            headers={'Authorization': f'Bearer {credentials.token}'}, json={'message': {
                'token': value, 'data': {'budgetlyUpdate': 'true', 'version': version, 'title': title, 'body': body},
                'android': {'priority': 'normal', 'ttl': '86400s', 'collapse_key': 'budgetly-updates'}}})
    if result.status_code == 404 and 'UNREGISTERED' in result.text:
        return 410
    return result.status_code


def dispatch_updates(db):
    """Bound each run; unsent devices remain eligible for the next run."""
    ready = configured()
    if not any(ready.values()):
        return {'configured': False, 'sent': 0, 'failed': 0}
    from .app_updates import load_release
    android = None
    if ready['android']:
        try:
            android = load_release()
        except Exception:
            pass
    db.query(UpdatePushDevice).filter(UpdatePushDevice.updated_at < utc_now() - timedelta(days=180)).delete()
    versions = {'browser': VERSION, 'android': android['version'] if android else None}
    sent = failed = 0
    deadline = time.monotonic() + 20
    for platform, version in versions.items():
        if not version or not ready[platform]:
            continue
        rows = db.query(UpdatePushDevice).join(User, User.id == UpdatePushDevice.user_id).filter(
            User.active == True, UpdatePushDevice.platform == platform,
            (UpdatePushDevice.last_version.is_(None)) | (UpdatePushDevice.last_version != version)).order_by(UpdatePushDevice.updated_at).limit(10).all()
        for row in rows:
            if time.monotonic() >= deadline:
                break
            if not newer(version, row.installed_version):
                row.last_version = version
                continue
            try:
                status = send_device(row, version)
            except Exception:
                status = 503
            if 200 <= status < 300:
                row.last_version = version; sent += 1
            elif status in (404, 410):
                db.delete(row)
            else:
                failed += 1
        db.commit()
    return {'configured': True, 'sent': sent, 'failed': failed}
