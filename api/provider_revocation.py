"""Durable Drive revocation work; credentials never enter logs or responses."""
import os
import secrets
import time
from datetime import timedelta

import httpx
from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import or_

from .models import ProviderRevocationJob as Job, utc_now

REVOKE_URL = 'https://oauth2.googleapis.com/revoke'


def enqueue(db, user_id, ciphertext):
    job = Job(id=secrets.token_hex(32), user_id=user_id, token=ciphertext)
    db.add(job)
    db.flush()
    return job.id


def pending(db, user_id):
    return db.query(Job.id).filter_by(user_id=user_id, status='pending').first() is not None


def claim(db, job_id):
    now = utc_now()
    lease = secrets.token_hex(32)
    changed = db.query(Job).filter_by(id=job_id, status='pending').filter(
        Job.next_attempt_at <= now,
        or_(Job.lease_until.is_(None), Job.lease_until <= now),
    ).update({'lease_id': lease, 'lease_until': now + timedelta(minutes=2)}, synchronize_session=False)
    db.commit()
    if not changed:
        return None
    job = db.query(Job).filter_by(id=job_id, lease_id=lease).populate_existing().one()
    return lease, job.token


def token(ciphertext):
    try:
        return Fernet(os.getenv('GOOGLE_DRIVE_ENCRYPTION_KEY', '').encode()).decrypt(ciphertext.encode()).decode()
    except (ValueError, InvalidToken, UnicodeError, AttributeError):
        raise ValueError('credential_unreadable') from None


def finish(db, job_id, lease, error=None):
    job = db.query(Job).filter_by(id=job_id, status='pending', lease_id=lease).populate_existing().first()
    if not job:
        return
    attempts = job.attempts + 1
    values = {'lease_id': None, 'lease_until': None, 'attempts': attempts, 'error': error}
    if error:
        delay = min(86400, 60 * (2 ** min(attempts, 10))) + secrets.randbelow(60)
        values['next_attempt_at'] = utc_now() + timedelta(seconds=delay)
    else:
        values.update(status='completed', token=None)
    db.query(Job).filter_by(id=job_id, lease_id=lease).update(values, synchronize_session=False)
    db.commit()


def revoked(response):
    if response.is_success:
        return True
    if response.status_code == 400:
        try:
            body = response.json()
            return isinstance(body, dict) and body.get('error') == 'invalid_token'
        except ValueError:
            pass
    return False


def retry_due(db, maximum=10):
    ids = [row[0] for row in db.query(Job.id).filter_by(status='pending').filter(
        Job.next_attempt_at <= utc_now()).order_by(Job.next_attempt_at).limit(min(maximum, 10))]
    completed = failed = 0
    deadline = time.monotonic() + 40
    for job_id in ids:
        if time.monotonic() >= deadline:
            break
        claimed = claim(db, job_id)
        if not claimed:
            continue
        lease, ciphertext = claimed
        error = None
        try:
            credential = token(ciphertext)
            remaining = min(4, deadline - time.monotonic())
            if remaining <= 0:
                finish(db, job_id, lease, 'transport_failure')
                break
            request_deadline = time.monotonic() + remaining
            with httpx.Client(timeout=remaining, follow_redirects=False, trust_env=False) as client:
                with client.stream('POST', REVOKE_URL, data={'token': credential}) as remote:
                    body = bytearray()
                    # Successful revocation has no response body to retain.
                    if not remote.is_success:
                        for chunk in remote.iter_raw():
                            if len(body) + len(chunk) > 4096 or time.monotonic() > request_deadline:
                                raise httpx.ReadError('Bounded revocation response exceeded')
                            body.extend(chunk)
                    response = httpx.Response(remote.status_code, content=bytes(body))
            if not revoked(response):
                error = 'provider_failure'
        except ValueError:
            error = 'credential_unreadable'
        except httpx.HTTPError:
            error = 'transport_failure'
        finish(db, job_id, lease, error)
        completed += error is None
        failed += error is not None
    return {'completed': completed, 'failed': failed}
