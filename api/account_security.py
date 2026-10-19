"""Revocable sessions, password confirmation, and private activity history."""
import hashlib
import json
import secrets
from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy import case
from .database import get_db
from .models import User, utc_now
from .reliability_models import AccountSession, Activity, RateBucket, ResetToken
from .client_address import client_address

router = APIRouter()


def audit(db, user_id, actor_id, action, resource='account'):
    context = db.info.get('space')
    if context:
        actor_id = context.actor_id
        if context.id is not None:
            resource = f'space:{context.id}/{resource}'
    db.add(Activity(user_id=user_id, actor_id=actor_id, action=action[:160], resource=resource[:80]))


def limit(db, key, maximum=10, seconds=300):
    digest = hashlib.sha256(key.encode()).hexdigest()
    row = db.query(RateBucket).filter_by(key=digest).with_for_update().first()
    if row is None:
        try:
            with db.begin_nested():
                row = RateBucket(key=digest, count=0, started=utc_now())
                db.add(row); db.flush()
        except IntegrityError:
            row = db.query(RateBucket).filter_by(key=digest).with_for_update().one()
    now = utc_now()
    expired = RateBucket.started <= now - timedelta(seconds=seconds)
    count = db.execute(RateBucket.__table__.update().where(RateBucket.key == digest).values(
        started=case((expired, now), else_=RateBucket.started),
        count=case((expired, 1), else_=RateBucket.count + 1),
    ).returning(RateBucket.count)).scalar_one()
    blocked = count > maximum
    db.commit()
    if blocked:
        raise HTTPException(429, 'Too many attempts. Please wait a few minutes and try again.', headers={'Retry-After': str(seconds)})


def confirmed(request, db, user):
    sid = getattr(request.state, 'session_id', None)
    session = db.get(AccountSession, sid) if sid else None
    if (not session or session.user_id != user.id or session.revoked
            or session.created_at <= utc_now() - timedelta(days=1)
            or not session.verified_at or session.verified_at < utc_now() - timedelta(minutes=5)):
        raise HTTPException(428, 'Confirm your identity before this action.')


from .index import current_user, admin_user, verify_password, hash_password


def cancel_pending_signins(db, user_id):
    from .google_auth import GoogleAuthState
    db.query(GoogleAuthState).filter_by(user_id=user_id).filter(
        GoogleAuthState.status.in_(['ready', 'pending', 'exchanging', 'processing'])
    ).update({'status': 'cancelled', 'verifier': ''}, synchronize_session=False)
    cancel_drive_consent(db, user_id)


def cancel_drive_consent(db, user_id, session_id=None):
    from .google_drive import GoogleDriveOAuthAttempt
    query = db.query(GoogleDriveOAuthAttempt).filter_by(user_id=user_id)
    if session_id is not None:
        query = query.filter_by(session_id=session_id)
    query.filter(GoogleDriveOAuthAttempt.status.in_(['pending', 'processing'])).update(
        {'status': case((GoogleDriveOAuthAttempt.status == 'processing', 'cancelling'), else_='cancelled'),
         'verifier': None}, synchronize_session=False)


class PasswordIn(BaseModel):
    password: str = Field(min_length=8, max_length=128)


class ResetIn(BaseModel):
    token: str = Field(min_length=20, max_length=100)
    password: str = Field(min_length=12, max_length=128)


class EmailIn(BaseModel):
    email: str = Field(min_length=5, max_length=160)


@router.post('/api/account/confirm')
def confirm_password(payload: PasswordIn, request: Request, user=Depends(current_user), db=Depends(get_db)):
    limit(db, f'confirm:{user.id}', 5)
    if not verify_password(payload.password, user.password_hash):
        raise HTTPException(401, 'Incorrect password')
    session = db.get(AccountSession, request.state.session_id)
    session.verified_at = utc_now(); db.commit()
    return {'confirmed': True, 'valid_for_seconds': 300}


@router.get('/api/account/sessions')
def sessions(request: Request, user=Depends(current_user), db=Depends(get_db)):
    rows = db.query(AccountSession).filter_by(user_id=user.id, revoked=False).filter(AccountSession.created_at > utc_now()-timedelta(days=1)).order_by(AccountSession.last_seen.desc()).all()
    return [{'id': r.id, 'label': r.label, 'created_at': r.created_at.isoformat()+'Z', 'last_seen': r.last_seen.isoformat()+'Z', 'current': r.id == request.state.session_id} for r in rows]


@router.delete('/api/account/sessions/{session_id}', status_code=204)
def revoke_session(session_id: str, user=Depends(current_user), db=Depends(get_db)):
    row = db.query(AccountSession).filter_by(id=session_id, user_id=user.id).first()
    if not row: raise HTTPException(404, 'Session not found')
    row.revoked = True
    db.flush()
    cancel_drive_consent(db, user.id, session_id)
    audit(db, user.id, user.id, 'Signed out a session')
    db.commit()


@router.post('/api/account/signout-all')
def signout_all(user=Depends(current_user), db=Depends(get_db)):
    db.query(AccountSession).filter_by(user_id=user.id).update({'revoked': True})
    cancel_pending_signins(db, user.id)
    audit(db, user.id, user.id, 'Signed out all sessions'); db.commit()
    return {'ok': True}


@router.post('/api/account/signout', status_code=204)
def signout(request: Request, user=Depends(current_user), db=Depends(get_db)):
    from .workspace import count_feedback_event
    count_feedback_event(db, user.id)
    row=db.get(AccountSession,request.state.session_id)
    row.revoked=True;db.flush()
    cancel_drive_consent(db, user.id, row.id)
    db.commit()


@router.get('/api/account/activity')
def activity(user=Depends(current_user), db=Depends(get_db)):
    rows = db.query(Activity).filter_by(user_id=user.id).order_by(Activity.id.desc()).limit(100).all()
    actors = {r.id: r.username for r in db.query(User).filter(User.id.in_({r.actor_id for r in rows})).all()}
    return [{'id':r.id, 'action':r.action, 'resource':r.resource, 'actor':actors.get(r.actor_id, 'Former user'), 'created_at':r.created_at.isoformat()+'Z'} for r in rows]


def send_reset(db, target, actor_id):
    from .email_service import send_password_reset
    token = secrets.token_urlsafe(32)
    db.query(ResetToken).filter_by(user_id=target.id).delete()
    db.add(ResetToken(user_id=target.id, digest=hashlib.sha256(token.encode()).hexdigest(), expires=utc_now()+timedelta(minutes=20)))
    send_password_reset(target.email, token)
    audit(db, target.id, actor_id, 'Password reset requested'); db.commit()


@router.post('/api/auth/password-reset/request')
def request_reset(payload: EmailIn, request: Request, db=Depends(get_db)):
    email = payload.email.strip().lower()
    # Fixed aggregate buckets bound abuse before attacker-selected email keys.
    limit(db, 'reset-global', 300, 3600)
    limit(db, 'reset-ip:' + client_address(request), 20, 3600)
    limit(db, 'reset:'+email, 3, 3600)
    target = db.query(User).filter_by(email=email, active=True).first()
    if target:
        send_reset(db, target, target.id)
    return {'message': 'If an active account matches, a password reset link will arrive shortly.'}


@router.post('/api/auth/password-reset/complete')
def complete_reset(payload: ResetIn, db=Depends(get_db)):
    digest = hashlib.sha256(payload.token.encode()).hexdigest()
    row = db.query(ResetToken).filter_by(digest=digest).with_for_update().first()
    if not row or row.expires < utc_now(): raise HTTPException(400, 'Reset link expired or already used. Request another link.')
    user = db.get(User, row.user_id)
    if not user or not user.active: raise HTTPException(400, 'Account unavailable')
    # Claim before changing credentials; row locks alone do not protect SQLite.
    claimed = db.query(ResetToken).filter_by(digest=digest).filter(
        ResetToken.expires > utc_now()).delete(synchronize_session=False)
    if claimed != 1:
        db.rollback()
        raise HTTPException(400, 'Reset link expired or already used. Request another link.')
    user.password_hash = hash_password(payload.password)
    # Match Drive callback lock order: credentials, then session, then consent.
    db.flush()
    db.query(AccountSession).filter_by(user_id=user.id).update({'revoked':True})
    cancel_pending_signins(db, user.id)
    audit(db, user.id, user.id, 'Password reset completed'); db.commit()
    return {'ok':True}


@router.post('/api/admin/users/{user_id}/password-reset')
def admin_reset(user_id: int, request: Request, admin=Depends(admin_user), db=Depends(get_db)):
    confirmed(request, db, admin)
    limit(db, f'admin-reset:{admin.id}:{user_id}', 3, 3600)
    target = db.get(User, user_id)
    if not target: raise HTTPException(404, 'User not found')
    send_reset(db, target, admin.id)
    return {'ok': True}
