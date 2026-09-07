"""Server-verified passkeys with expiring, single-use challenges."""
import json
import os
import secrets
from datetime import datetime, timedelta
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import Column, String, DateTime
from sqlalchemy.orm import Session
from webauthn import generate_registration_options, generate_authentication_options, verify_registration_response, verify_authentication_response, options_to_json
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url
from webauthn.helpers.structs import AuthenticatorSelectionCriteria, ResidentKeyRequirement, UserVerificationRequirement, PublicKeyCredentialDescriptor
from .database import Base, get_db
from .index import current_user, issue_token, user_payload, verify_password, set_setting
from .models import AppSetting, User, utc_now

router = APIRouter()

class PasskeyChallenge(Base):
    __tablename__ = 'passkey_challenges'
    id = Column(String(64), primary_key=True)
    value = Column(String(256), nullable=False)
    purpose = Column(String(40), nullable=False)
    expires = Column(DateTime, nullable=False)

class Password(BaseModel):
    password: str = Field(min_length=8, max_length=128)

class Response(BaseModel):
    challenge_id: str = Field(max_length=64)
    credential: dict

def origin():
    return os.getenv('WEBAUTHN_ORIGIN', 'https://budget-planner-ecru-seven.vercel.app').rstrip('/')

def rp_id():
    return urlparse(origin()).hostname

def challenge(db, options, purpose):
    db.query(PasskeyChallenge).filter(PasskeyChallenge.expires < utc_now()).delete()
    key = secrets.token_urlsafe(32)
    db.add(PasskeyChallenge(id=key, value=bytes_to_base64url(options.challenge), purpose=purpose, expires=utc_now()+timedelta(minutes=5)))
    db.commit()
    return {'challenge_id': key, 'options': json.loads(options_to_json(options))}

def consume(db, key, purpose):
    row = db.get(PasskeyChallenge, key)
    if not row or row.purpose != purpose or row.expires < utc_now():
        raise HTTPException(400, 'Passkey request expired. Please try again.')
    value = base64url_to_bytes(row.value)
    claimed = db.query(PasskeyChallenge).filter_by(id=key).delete()
    db.commit()
    if claimed != 1: raise HTTPException(400, 'Passkey request already used.')
    return value

@router.get('/api/passkeys')
def status(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return {'enabled': db.get(AppSetting, (user.id, 'passkey')) is not None}

@router.post('/api/passkeys/register/options')
def register_options(payload: Password, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if not verify_password(payload.password, user.password_hash): raise HTTPException(401, 'Incorrect password')
    options = generate_registration_options(rp_id=rp_id(), rp_name='FlowBudget', user_id=str(user.id).encode(), user_name=user.email,
        authenticator_selection=AuthenticatorSelectionCriteria(resident_key=ResidentKeyRequirement.REQUIRED, user_verification=UserVerificationRequirement.REQUIRED))
    return challenge(db, options, f'register:{user.id}')

@router.post('/api/passkeys/register/verify')
def register_verify(payload: Response, user: User = Depends(current_user), db: Session = Depends(get_db)):
    expected = consume(db, payload.challenge_id, f'register:{user.id}')
    try:
        verified = verify_registration_response(credential=payload.credential, expected_challenge=expected, expected_rp_id=rp_id(), expected_origin=origin(), require_user_verification=True)
    except Exception:
        raise HTTPException(400, 'Passkey could not be verified. Please try again.')
    set_setting(db, user.id, 'passkey', json.dumps({'id': bytes_to_base64url(verified.credential_id), 'key': bytes_to_base64url(verified.credential_public_key), 'count': verified.sign_count}))
    db.commit()
    return {'enabled': True}

@router.post('/api/passkeys/login/options')
def login_options(db: Session = Depends(get_db)):
    return challenge(db, generate_authentication_options(rp_id=rp_id(), user_verification=UserVerificationRequirement.REQUIRED), 'login')

@router.post('/api/passkeys/login/verify')
def login_verify(payload: Response, db: Session = Depends(get_db)):
    expected = consume(db, payload.challenge_id, 'login')
    # Lock the credential while advancing its authenticator counter.
    candidates = db.query(AppSetting).filter_by(key='passkey').with_for_update().all()
    row = next((r for r in candidates if json.loads(r.value)['id'] == payload.credential.get('id')), None)
    if not row: raise HTTPException(401, 'Passkey not recognized. Sign in with your password.')
    user = db.get(User, row.user_id)
    if not user or not user.active: raise HTTPException(401, 'Account unavailable')
    data = json.loads(row.value)
    try:
        result = verify_authentication_response(credential=payload.credential, expected_challenge=expected, expected_rp_id=rp_id(), expected_origin=origin(), credential_public_key=base64url_to_bytes(data['key']), credential_current_sign_count=data['count'], require_user_verification=True)
    except Exception:
        raise HTTPException(401, 'Passkey verification failed. Please try again.')
    data['count'] = result.new_sign_count
    row.value = json.dumps(data)
    db.commit()
    return {'token': issue_token(user), 'user': user_payload(user)}

@router.delete('/api/passkeys', status_code=204)
def revoke(user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.query(AppSetting).filter_by(user_id=user.id, key='passkey').delete()
    db.commit()
