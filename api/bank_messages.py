"""Opt-in SMS forwarding inbox; forwarded text never writes the ledger automatically."""
import re
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
    return {'enabled': False}


@router.post('/api/bank-messages/key')
def create_key(user=Depends(current_user), db=Depends(get_db)):
    raise HTTPException(410, 'Phone forwarding retired. Use Smart Bank Inbox in Settings.')


@router.delete('/api/bank-messages/key', status_code=204)
def revoke_key(user=Depends(current_user), db=Depends(get_db)):
    db.query(MessageKey).filter_by(user_id=user.id).delete()
    db.commit()


def ingest(db, user_id, payload):
    db.query(User).filter_by(id=user_id).with_for_update().first()
    if re.search(r'\b(otp|verification|one.time|password|passcode|login|pin)\b|\u0631\u0645\u0632\s*(?:\u0627\u0644\u062a\u062d\u0642\u0642|\u0627\u0644\u062a\u0641\u0639\u064a\u0644)|\u0643\u0644\u0645\u0629\s*\u0627\u0644\u0645\u0631\u0648\u0631', payload.message, re.I):
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
    raise HTTPException(410, 'Phone forwarding retired. Use Smart Bank Inbox in Settings.')


@router.post('/api/bank-messages', status_code=201)
def paste_message(payload: MessageIn, user=Depends(current_user), db=Depends(get_db)):
    return ingest(db, user.id, payload)


@router.get('/api/bank-messages')
def messages(user=Depends(current_user), db=Depends(get_db)):
    from .message_parser import suggest
    from .index import setting
    currency=setting(db,user.id,'currency','KWD')
    rows=db.query(BankMessage).filter_by(user_id=user.id, recorded=False).order_by(BankMessage.id.desc()).limit(500).all()
    texts={}
    for row in db.query(BankMessage).filter_by(user_id=user.id).all():
        key=(row.bank,row.message.strip());texts[key]=texts.get(key,0)+1
    return [{'id':r.id,'bank':r.bank,'message':r.message,'created_at':r.created_at.isoformat()+'Z','suggestions':suggest(r.message,currency),'possible_duplicate':texts[(r.bank,r.message.strip())]>1} for r in rows]


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
