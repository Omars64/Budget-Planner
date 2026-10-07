"""Opt-in alerts, without amounts, wallet names, or full transaction descriptions."""
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
from sqlalchemy import Column, DateTime, ForeignKey, String, Text, Integer, UniqueConstraint
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


class ScheduledPush(Base):
    __tablename__ = 'scheduled_push_outbox'
    id = Column(Integer, primary_key=True)
    plan_id = Column(ForeignKey('planned_transactions.id', ondelete='CASCADE'), nullable=False)
    device_id = Column(ForeignKey('update_push_devices.id', ondelete='CASCADE'), nullable=False)
    created_at = Column(DateTime, nullable=False, default=utc_now)
    sent_at = Column(DateTime, index=True)
    __table_args__ = (UniqueConstraint('plan_id', 'device_id', name='uq_scheduled_push_plan_device'),)


def device_payload(row):
    value = json.loads(cipher().decrypt(row.payload.encode()))
    return value if isinstance(value, dict) and 'credentials' in value else {'credentials': value, 'updates': True, 'scheduled': False}


def queue_scheduled(db, plan):
    # Persist delivery intent in the same commit as the ledger entry.
    if not os.getenv('UPDATE_PUSH_ENCRYPTION_KEY'):
        return
    for device in db.query(UpdatePushDevice).filter_by(user_id=plan.created_by_id).all():
        try:
            enabled = device_payload(device).get('scheduled', False)
        except Exception:
            enabled = False
        if enabled:
            db.add(ScheduledPush(plan_id=plan.id, device_id=device.id))


def dispatch_scheduled(db):
    from .models import PlannedTransaction
    sent = failed = 0
    db.query(ScheduledPush).filter(ScheduledPush.sent_at < utc_now() - timedelta(days=30)).delete(synchronize_session=False)
    query = db.query(ScheduledPush).filter(ScheduledPush.sent_at.is_(None)).order_by(ScheduledPush.id)
    if db.bind.dialect.name == 'postgresql':
        query = query.with_for_update(skip_locked=True)
    deadline = time.monotonic() + 15
    for event in query.limit(5).all():
        if time.monotonic() >= deadline:
            break
        device = db.get(UpdatePushDevice, event.device_id)
        plan = db.get(PlannedTransaction, event.plan_id)
        user = db.get(User, device.user_id) if device else None
        try:
            if not device or not plan or not user or not user.active or plan.status != 'posted' or not device_payload(device).get('scheduled') or event.created_at < utc_now() - timedelta(days=1):
                event.sent_at = utc_now()
                continue
            # No amount, wallet name or full description is included on the lock screen.
            notice = {'kind': 'scheduled', 'event': str(event.id), 'title': 'Scheduled entry recorded',
                      'body': f'Your scheduled {plan.type} was recorded.', 'version': VERSION}
            status = send_device(device, VERSION, notice=notice)
            if 200 <= status < 300 or status in (404, 410):
                event.sent_at = utc_now()
                sent += int(200 <= status < 300)
            else:
                failed += 1
        except Exception:
            failed += 1
    db.commit()
    return {'sent': sent, 'failed': failed}


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
    updates: bool = True
    scheduled: bool = False

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
    row.payload = cipher().encrypt(json.dumps({'credentials': payload.token if payload.platform == 'android' else payload.subscription,
                                             'updates': payload.updates, 'scheduled': payload.scheduled}).encode()).decode()
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


def send_device(row, version, test=False, notice=None):
    value = device_payload(row)['credentials']
    title = 'Budgetly test notification' if test else f'Budgetly {version} is available'
    body = 'Notifications are reaching this device.' if test else 'Open Budgetly to review the latest update.'
    if notice:
        title, body = notice['title'], notice['body']
    if row.platform == 'browser':
        from pywebpush import webpush, WebPushException
        from py_vapid import Vapid
        private_key = os.environ['WEB_PUSH_PRIVATE_KEY'].replace('\\n', '\n')
        vapid = Vapid.from_pem(private_key.encode()) if '-----BEGIN' in private_key else Vapid.from_string(private_key)
        try:
            webpush(value, json.dumps(notice or {'version': version, 'title': title, 'body': body, 'test': test}),
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
                'token': value,
                'data': {'budgetlyScheduled' if notice else 'budgetlyUpdateTest' if test else 'budgetlyUpdate': 'true', 'version': version, 'title': title, 'body': body, **({'event': notice['event']} if notice else {})},
                # Visible alerts may wake a sleeping device; background financial work never uses this channel.
                'android': {'priority': 'high', 'ttl': '300s' if test else '86400s',
                            **({} if notice else {'collapse_key': 'budgetly-test' if test else 'budgetly-updates'}),
                            **({'notification': {'channel_id': 'budgetly-updates', 'tag': 'budgetly-test'}} if test else {})},
                **({'notification': {'title': title, 'body': body}} if test else {})}})
    if result.status_code == 404 and 'UNREGISTERED' in result.text:
        return 410
    return result.status_code


@router.get('/api/app-updates/push-devices')
def device_status(response: Response, user=Depends(current_user), db=Depends(get_db)):
    response.headers['Cache-Control'] = 'no-store'
    rows = db.query(UpdatePushDevice).filter_by(user_id=user.id).order_by(UpdatePushDevice.updated_at.desc()).all()
    return {'devices': [{'id': row.id, 'platform': row.platform, 'installed_version': row.installed_version,
                         'last_accepted_version': row.last_version,
                         'registered_at': row.updated_at.isoformat() + 'Z'} for row in rows]}


@router.post('/api/app-updates/push-device/{device_id}/test')
def test_delivery(device_id: UUID, user=Depends(current_user), db=Depends(get_db)):
    from .account_security import limit
    limit(db, f'update-push-test:{user.id}', maximum=3, seconds=300)
    row = db.query(UpdatePushDevice).filter_by(id=str(device_id), user_id=user.id).first()
    if not row:
        raise HTTPException(404, 'Registered device not found. Save notifications on that device first.')
    if not configured()[row.platform]:
        raise HTTPException(503, 'Notification sender is not configured.')
    try:
        status = send_device(row, row.installed_version, test=True)
    except Exception:
        raise HTTPException(503, 'The notification provider could not be reached. Please retry.') from None
    if status in (404, 410):
        db.delete(row); db.commit()
        raise HTTPException(409, 'Device registration expired. Save notifications on that device again.')
    if not 200 <= status < 300:
        raise HTTPException(503, 'The notification provider rejected this test. Check sender configuration.')
    return {'accepted': True, 'message': 'Test accepted by the provider. Check the selected device; delivery is not yet confirmed.'}


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
                if not device_payload(row).get('updates', True):
                    continue
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
