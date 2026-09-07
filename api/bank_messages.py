"""Opt-in SMS forwarding inbox; forwarded text never writes the ledger automatically."""
import hashlib
import re
import secrets
from typing import Literal
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from .database import get_db
from .index import current_user, validate_transaction_references, tx_payload
from .models import BankMessage, MessageKey, Transaction, User
from .schemas import TransactionIn

router = APIRouter()


class MessageIn(BaseModel):
    bank: Literal['NBK', 'KFH', 'Gulf Bank', 'CBK']
    reference: str = Field(min_length=1, max_length=160)
    message: str = Field(min_length=1, max_length=2000)


@router.get('/api/bank-messages/key')
def key_status(user=Depends(current_user), db=Depends(get_db)):
    return {'enabled': db.get(MessageKey, user.id) is not None}


@router.post('/api/bank-messages/key')
def create_key(user=Depends(current_user), db=Depends(get_db)):
    token = secrets.token_urlsafe(32)
    row = db.get(MessageKey, user.id)
    if not row:
        row = MessageKey(user_id=user.id); db.add(row)
    row.digest = hashlib.sha256(token.encode()).hexdigest()
    db.commit()
    return {'token': token}


@router.delete('/api/bank-messages/key', status_code=204)
def revoke_key(user=Depends(current_user), db=Depends(get_db)):
    db.query(MessageKey).filter_by(user_id=user.id).delete()
    db.commit()


def ingest(db, user_id, payload):
    if re.search(r'\b(otp|verification|one.time|password|passcode)\b', payload.message, re.I):
        raise HTTPException(422, 'Verification codes and passwords must not be forwarded')
    existing = db.query(BankMessage).filter_by(user_id=user_id, reference=payload.reference).first()
    if existing: return {'id': existing.id, 'duplicate': True}
    if db.query(BankMessage).filter_by(user_id=user_id, recorded=False).count() >= 500:
        raise HTTPException(429, 'Review or remove pending bank messages before sending more')
    row = BankMessage(user_id=user_id, **payload.model_dump())
    try:
        with db.begin_nested():
            db.add(row); db.flush()
    except IntegrityError:
        row = db.query(BankMessage).filter_by(user_id=user_id, reference=payload.reference).one()
    db.commit()
    return {'id': row.id}


@router.post('/api/bank-messages/forward', status_code=201)
def forward(payload: MessageIn, x_flowbudget_key: str = Header(default='', max_length=100), db=Depends(get_db)):
    key = db.query(MessageKey).filter_by(digest=hashlib.sha256(x_flowbudget_key.encode()).hexdigest()).first()
    if not key or not db.query(User).filter_by(id=key.user_id, active=True).first():
        raise HTTPException(401, 'Invalid or revoked forwarding key')
    return ingest(db, key.user_id, payload)


@router.post('/api/bank-messages', status_code=201)
def paste_message(payload: MessageIn, user=Depends(current_user), db=Depends(get_db)):
    return ingest(db, user.id, payload)


@router.get('/api/bank-messages')
def messages(user=Depends(current_user), db=Depends(get_db)):
    return db.query(BankMessage).filter_by(user_id=user.id, recorded=False).order_by(BankMessage.id.desc()).limit(500).all()


@router.post('/api/bank-messages/{message_id}/record')
def record(message_id: int, payload: TransactionIn, user=Depends(current_user), db=Depends(get_db)):
    row = db.query(BankMessage).filter_by(id=message_id, user_id=user.id).with_for_update().first()
    if not row: raise HTTPException(404, 'Message not found')
    if row.recorded: raise HTTPException(409, 'This message has already been recorded')
    if payload.type != 'expense' or payload.recurring_frequency != 'none':
        raise HTTPException(422, 'Bank messages can be recorded as one-time expenses only')
    validate_transaction_references(db, user.id, payload)
    # Atomic claim protects concurrent submissions on both PostgreSQL and SQLite.
    claimed = db.query(BankMessage).filter_by(id=row.id, recorded=False).update({'recorded': True})
    if not claimed: raise HTTPException(409, 'This message has already been recorded')
    tx = Transaction(user_id=user.id, **payload.model_dump()); db.add(tx); db.flush()
    result = tx_payload(tx); db.commit()
    return result


@router.delete('/api/bank-messages/{message_id}', status_code=204)
def remove(message_id: int, user=Depends(current_user), db=Depends(get_db)):
    db.query(BankMessage).filter_by(id=message_id, user_id=user.id, recorded=False).delete()
    db.commit()
