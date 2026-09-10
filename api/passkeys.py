"""Server-verified passkeys with expiring, single-use challenges."""
import json
import os
import secrets
from datetime import datetime, timedelta
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import Column, String, DateTime, Integer, ForeignKey, Text
from sqlalchemy.orm import Session
from webauthn import generate_registration_options, generate_authentication_options, verify_registration_response, verify_authentication_response, options_to_json
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url
from webauthn.helpers.structs import AuthenticatorSelectionCriteria, ResidentKeyRequirement, UserVerificationRequirement, PublicKeyCredentialDescriptor
from .database import Base, get_db
from .index import current_user, issue_token, user_payload, verify_password
from .models import AppSetting, User, utc_now
from .android_identity import ANDROID_ORIGIN, ANDROID_RP_ID, asset_links

router = APIRouter()

class Passkey(Base):
    __tablename__ = 'account_passkeys'
    id = Column(String(1400), primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    public_key = Column(Text, nullable=False)
    sign_count = Column(Integer, nullable=False, default=0)

def migrate_passkeys(db):
    # Move credentials out of preferences before any workbook restore can erase them.
    for row in db.query(AppSetting).filter_by(key='passkey').all():
        try:
            data = json.loads(row.value)
            credential_id = bytes_to_base64url(base64url_to_bytes(data['id']))
            base64url_to_bytes(data['key'])
            count = int(data['count'])
        except (ValueError, TypeError, KeyError):
            continue
        if db.get(Passkey, credential_id) is None:
            db.add(Passkey(id=credential_id, user_id=row.user_id, public_key=data['key'], sign_count=count))
        db.delete(row)
    db.flush()

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

def trusted_origins():
    # Only the published release certificate is trusted, not localhost or debug keys.
    return [origin(), ANDROID_ORIGIN] if rp_id() == ANDROID_RP_ID else [origin()]

@router.get('/.well-known/assetlinks.json')
def android_asset_links():
    return asset_links() if rp_id() == ANDROID_RP_ID else []

def canonical_credential_id(payload):
    """Use rawId as the canonical credential identifier across browsers."""
    raw_id = payload.get('rawId') or payload.get('id')
    if not isinstance(raw_id, str) or not raw_id:
        raise ValueError('missing credential id')
    return bytes_to_base64url(base64url_to_bytes(raw_id))

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
    return {'enabled': db.query(Passkey).filter_by(user_id=user.id).first() is not None}

@router.post('/api/passkeys/register/options')
def register_options(payload: Password, user: User = Depends(current_user), db: Session = Depends(get_db)):
    from .account_security import limit
    limit(db, f'passkey-register:{user.id}', 10)
    if not verify_password(payload.password, user.password_hash): raise HTTPException(401, 'Incorrect password')
    options = generate_registration_options(rp_id=rp_id(), rp_name='FlowBudget', user_id=str(user.id).encode(), user_name=user.email,
        exclude_credentials=[PublicKeyCredentialDescriptor(id=base64url_to_bytes(row.id)) for row in db.query(Passkey).filter_by(user_id=user.id).all()],
        authenticator_selection=AuthenticatorSelectionCriteria(resident_key=ResidentKeyRequirement.REQUIRED, user_verification=UserVerificationRequirement.REQUIRED))
    return challenge(db, options, f'register:{user.id}')

@router.post('/api/passkeys/register/verify')
def register_verify(payload: Response, user: User = Depends(current_user), db: Session = Depends(get_db)):
    expected = consume(db, payload.challenge_id, f'register:{user.id}')
    try:
        verified = verify_registration_response(credential=payload.credential, expected_challenge=expected, expected_rp_id=rp_id(), expected_origin=trusted_origins(), require_user_verification=True)
    except Exception:
        raise HTTPException(400, 'Passkey could not be verified. Please try again.')
    credential_id = bytes_to_base64url(verified.credential_id)
    if db.get(Passkey, credential_id) is not None:
        raise HTTPException(409, 'This passkey is already registered. Choose another authenticator.')
    db.add(Passkey(id=credential_id, user_id=user.id, public_key=bytes_to_base64url(verified.credential_public_key), sign_count=verified.sign_count))
    db.commit()
    return {'enabled': True}

@router.post('/api/passkeys/login/options')
def login_options(db: Session = Depends(get_db)):
    return challenge(db, generate_authentication_options(rp_id=rp_id(), user_verification=UserVerificationRequirement.REQUIRED), 'login')

@router.post('/api/passkeys/login/verify')
def login_verify(payload: Response, db: Session = Depends(get_db)):
    expected = consume(db, payload.challenge_id, 'login')
    # Lock the credential while advancing its authenticator counter.
    try:
        credential_id = canonical_credential_id(payload.credential)
    except (KeyError, ValueError, TypeError):
        raise HTTPException(401, 'Invalid passkey response.')
    row = db.query(Passkey).filter_by(id=credential_id).with_for_update().first()
    if not row: raise HTTPException(401, 'This device passkey is no longer registered to FlowBudget. Sign in with your password, then register this device in Settings > Biometric sign-in.')
    user = db.get(User, row.user_id)
    if not user or not user.active: raise HTTPException(401, 'Account unavailable')
    try:
        result = verify_authentication_response(credential=payload.credential, expected_challenge=expected, expected_rp_id=rp_id(), expected_origin=trusted_origins(), credential_public_key=base64url_to_bytes(row.public_key), credential_current_sign_count=row.sign_count, require_user_verification=True)
    except Exception:
        raise HTTPException(401, 'Passkey verification failed. Please try again.')
    row.sign_count = result.new_sign_count
    db.commit()
    return {'token': issue_token(user), 'user': user_payload(user)}

@router.delete('/api/passkeys', status_code=204)
def revoke(request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    from .account_security import confirmed, audit
    confirmed(request, db, user)
    audit(db, user.id, user.id, 'Revoked all passkeys')
    db.query(AppSetting).filter_by(user_id=user.id, key='passkey').delete()
    db.query(Passkey).filter_by(user_id=user.id).delete()
    db.commit()


@router.get('/api/passkeys/list')
def list_keys(user: User = Depends(current_user), db: Session = Depends(get_db)):
    import hashlib
    return [{'id':r.id,'fingerprint':hashlib.sha256(r.id.encode()).hexdigest()[:12]} for r in db.query(Passkey).filter_by(user_id=user.id).all()]


@router.delete('/api/passkeys/item/{credential_id}', status_code=204)
def revoke_one(credential_id: str, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    from .account_security import confirmed, audit
    confirmed(request, db, user)
    row=db.query(Passkey).filter_by(id=credential_id,user_id=user.id).first()
    if not row: raise HTTPException(404,'Passkey not found')
    db.delete(row); audit(db,user.id,user.id,'Revoked a passkey'); db.commit()
