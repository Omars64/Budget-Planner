"""Private, structured bank alerts. Approval is the only ledger-writing operation."""
import json
import re
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.exc import IntegrityError
from .database import get_db
from .auth_dependency import current_user
from .models import BankCandidate, BankSourceMapping, BankMerchantMemory, Wallet, Category, Space, User, Transaction
from .spaces import member_role, workspace_actor
from .schemas import TransactionWriteIn
from .timekeeping import ledger_time
from .currency import currency_digits

router = APIRouter(prefix='/api/bank-inbox', tags=['Bank Inbox'])


class CandidateIn(BaseModel):
    model_config = ConfigDict(extra='forbid')
    content_hash: str = Field(pattern=r'^[a-f0-9]{64}$')
    source_package: str = Field(min_length=1, max_length=180, pattern=r'^[a-zA-Z0-9_.-]+$')
    source_app: str = Field(min_length=1, max_length=100)
    transaction_type: Literal['expense', 'income', 'refund', 'transfer', 'withdrawal']
    amount: Decimal = Field(gt=0, lt=Decimal('1000000000000'), decimal_places=3)
    currency: str = Field(pattern=r'^[A-Z]{3,8}$')
    merchant: str = Field(min_length=1, max_length=160)
    account_last4: str = Field(default='', pattern=r'^(\d{4})?$')
    occurred_at: datetime
    confidence: Decimal = Field(ge=0, le=1)
    reasons: list[str] = Field(default_factory=list, max_length=12)

    @field_validator('merchant', 'source_app')
    @classmethod
    def safe_text(cls, value):
        if re.search(r'\b(?:otp|one.time password|verification code|authentication code|password|passcode|do not share)\b|(?:\d[ -]?){12,}', value, re.I):
            raise ValueError('Sensitive bank text cannot be stored')
        return value.strip()

    @field_validator('reasons')
    @classmethod
    def safe_reasons(cls, values):
        allowed = {'Amount detected', 'Transaction type detected', 'Merchant detected', 'Card ending detected', 'Timestamp needs review', 'Multiple amounts: review required'}
        if any(value not in allowed for value in values):
            raise ValueError('Invalid parser reason')
        return values


class MappingIn(BaseModel):
    source_package: str = Field(min_length=1, max_length=180, pattern=r'^[a-zA-Z0-9_.-]+$')
    account_last4: str = Field(default='', pattern=r'^(\d{4})?$')
    wallet_id: int


class ApprovalIn(TransactionWriteIn):
    add_anyway: bool = False
    remember: bool = True
    refund_of_id: int | None = None


def accessible_wallet(db, actor, wallet_id, write=False):
    wallet = db.query(Wallet).filter_by(id=wallet_id, archived=False).first()
    if not wallet:
        raise HTTPException(400, 'Choose an active wallet')
    if wallet.space_id:
        space = db.get(Space, wallet.space_id)
        role = member_role(db, space, actor)
        if write and role == 'view':
            raise HTTPException(403, 'View-only members cannot record transactions')
        if role != 'owner':
            from .models import WalletShare
            grant = db.query(WalletShare).filter_by(wallet_id=wallet.id, invitee_email=actor.email.lower()).first()
            if not grant or grant.permission != role:
                raise HTTPException(403, 'Wallet access changed. Review space membership.')
    elif wallet.user_id != actor.id:
        raise HTTPException(403, 'Wallet is not yours')
    return wallet


def scope_id(db):
    context = db.info.get('space')
    return context.id if context else None


def candidate(db, actor, item_id):
    row = db.query(BankCandidate).filter_by(id=item_id, user_id=actor.id, space_id=scope_id(db)).first()
    if not row:
        raise HTTPException(404, 'Bank alert not found in this workspace')
    return row


def matches(db, wallet_id, amount, date, kind):
    return db.query(Transaction).filter(Transaction.wallet_id == wallet_id, Transaction.amount == amount,
        Transaction.type == kind, Transaction.is_opening_balance.is_(False),
        Transaction.date >= date - timedelta(days=1), Transaction.date <= date + timedelta(days=1)).order_by(Transaction.date.desc()).limit(5).all()


def serialize(db, row):
    kind = 'income' if row.transaction_type == 'refund' else 'transfer' if row.transaction_type == 'withdrawal' else row.transaction_type
    duplicates = matches(db, row.wallet_id, row.amount, row.occurred_at, kind) if row.wallet_id else []
    originals = matches(db, row.wallet_id, row.amount, row.occurred_at, 'expense') if row.wallet_id and row.transaction_type == 'refund' else []
    return {k: getattr(row, k) for k in ('id', 'space_id', 'source_package', 'source_app', 'transaction_type', 'currency', 'merchant', 'account_last4', 'wallet_id', 'category_id', 'status', 'transaction_id')} | {
        'amount': str(row.amount), 'occurred_at': row.occurred_at.isoformat(), 'confidence': float(row.confidence), 'reasons': json.loads(row.reasons),
        'duplicates': [{'id': t.id, 'description': t.description, 'date': t.date.isoformat()} for t in duplicates],
        'refund_matches': [{'id': t.id, 'description': t.description} for t in originals]}


@router.get('/mappings')
def mappings(actor=Depends(current_user), db=Depends(get_db)):
    result = []
    for row in db.query(BankSourceMapping).filter_by(user_id=actor.id).all():
        try:
            wallet = accessible_wallet(db, actor, row.wallet_id)
        except HTTPException:
            continue
        result.append({'id': row.id, 'source_package': row.source_package, 'account_last4': row.account_last4,
            'wallet_id': row.wallet_id, 'wallet_name': wallet.name, 'space_id': wallet.space_id})
    return result


@router.put('/mappings')
def map_wallet(payload: MappingIn, actor=Depends(current_user), db=Depends(get_db)):
    accessible_wallet(db, actor, payload.wallet_id, write=True)
    db.query(User).filter_by(id=actor.id).with_for_update().first()
    row = db.query(BankSourceMapping).filter_by(user_id=actor.id, source_package=payload.source_package, account_last4=payload.account_last4).first()
    if not row:
        row = BankSourceMapping(user_id=actor.id, **payload.model_dump()); db.add(row)
    else:
        row.wallet_id = payload.wallet_id
    db.commit()
    return {'saved': True}


@router.delete('/mappings/{item_id}', status_code=204)
def remove_mapping(item_id: int, actor=Depends(current_user), db=Depends(get_db)):
    db.query(BankSourceMapping).filter_by(id=item_id, user_id=actor.id).delete()
    db.commit()


@router.post('/ingest', status_code=201)
def ingest(payload: CandidateIn, actor=Depends(current_user), db=Depends(get_db)):
    db.query(User).filter_by(id=actor.id).with_for_update().first()
    row = db.query(BankCandidate).filter_by(user_id=actor.id, content_hash=payload.content_hash).first()
    if row:
        return {'id': row.id, 'duplicate': True}
    if db.query(BankCandidate).filter_by(user_id=actor.id, status='pending').count() >= 500:
        raise HTTPException(429, 'Review pending bank alerts before importing more')
    mapping = db.query(BankSourceMapping).filter_by(user_id=actor.id, source_package=payload.source_package, account_last4=payload.account_last4).first()
    if not mapping and payload.account_last4:
        mapping = db.query(BankSourceMapping).filter_by(user_id=actor.id, source_package=payload.source_package, account_last4='').first()
    wallet = None
    if mapping:
        try:
            wallet = accessible_wallet(db, actor, mapping.wallet_id, write=True)
        except HTTPException:
            pass  # Revoked mappings never silently route into a former space.
    data = payload.model_dump()
    data['occurred_at'] = ledger_time(payload.occurred_at)
    data['reasons'] = json.dumps(payload.reasons)
    row = BankCandidate(user_id=actor.id, space_id=wallet.space_id if wallet else None, wallet_id=wallet.id if wallet else None, **data)
    key = f'space:{row.space_id}' if row.space_id else 'personal'
    memory = db.query(BankMerchantMemory).filter_by(user_id=actor.id, scope_key=key, merchant_key=row.merchant.casefold(), kind=row.transaction_type).first()
    if memory:
        row.category_id = memory.category_id
    elif wallet:
        historical = db.query(Transaction).filter_by(wallet_id=wallet.id, description=row.merchant).filter(Transaction.category_id.is_not(None)).order_by(Transaction.date.desc()).first()
        if historical:
            row.category_id = historical.category_id
    try:
        with db.begin_nested():
            db.add(row); db.flush()
    except IntegrityError:
        existing = db.query(BankCandidate).filter_by(user_id=actor.id, content_hash=payload.content_hash).first()
        if not existing:
            raise
        return {'id': existing.id, 'duplicate': True}
    db.commit()
    return {'id': row.id, 'space_id': row.space_id}


@router.get('')
def inbox(status: Literal['pending', 'ignored', 'approved'] = 'pending', limit: int = Query(default=100, ge=1, le=100), page: int = Query(default=1, ge=1, le=100), actor=Depends(workspace_actor), db=Depends(get_db)):
    query = db.query(BankCandidate).filter_by(user_id=actor.id, space_id=scope_id(db), status=status)
    return {'total': query.count(), 'items': [serialize(db, row) for row in query.order_by(BankCandidate.id.desc()).offset((page-1)*limit).limit(limit).all()]}


@router.get('/stats')
def stats(actor=Depends(workspace_actor), db=Depends(get_db)):
    return {'pending': db.query(BankCandidate).filter_by(user_id=actor.id, space_id=scope_id(db), status='pending').count()}


@router.get('/{item_id}')
def detail(item_id: int, actor=Depends(workspace_actor), db=Depends(get_db)):
    return serialize(db, candidate(db, actor, item_id))


@router.post('/{item_id}/approve')
def approve(item_id: int, payload: ApprovalIn, actor=Depends(workspace_actor), db=Depends(get_db)):
    from .index import add_transaction, tx_payload, setting
    # User and candidate locks serialize approvals even across browser tabs.
    db.query(User).filter_by(id=actor.id).with_for_update().first()
    row = candidate(db, actor, item_id)
    if row.status == 'approved':
        return {'status': 'approved', 'transaction_id': row.transaction_id}
    if row.status != 'pending':
        raise HTTPException(409, 'Restore this alert before recording it')
    context = db.info.get('space')
    owner_id = context.owner_id if context else actor.id
    expected = context.currency if context and context.id else setting(db, actor.id, 'currency', 'KWD')
    if row.currency != expected:
        raise HTTPException(422, f'Alert currency is {row.currency}; this workspace uses {expected}. No exchange conversion is applied.')
    if payload.amount != payload.amount.quantize(Decimal(1).scaleb(-currency_digits(expected))):
        raise HTTPException(422, 'Amount has too many decimal places for this currency')
    if payload.recurring_frequency != 'none':
        raise HTTPException(422, 'Bank alerts must be recorded once')
    if row.transaction_type == 'refund' and payload.type != 'income':
        raise HTTPException(422, 'Refunds must credit the wallet')
    duplicates = matches(db, payload.wallet_id, payload.amount, payload.date, payload.type)
    if duplicates and not payload.add_anyway:
        raise HTTPException(409, 'A similar transaction already exists. Review it or explicitly choose Add anyway.')
    if payload.refund_of_id:
        original = db.query(Transaction).filter_by(id=payload.refund_of_id, user_id=owner_id, wallet_id=payload.wallet_id, type='expense').first()
        if row.transaction_type != 'refund' or not original:
            raise HTTPException(400, 'Choose an original expense in this wallet')
    claimed = db.query(BankCandidate).filter_by(id=row.id, status='pending').update({'status': 'approved'}, synchronize_session=False)
    if not claimed:
        raise HTTPException(409, 'This alert is being processed; refresh the inbox')
    notes = payload.notes + f'\nBank alert: {row.transaction_type}; {row.source_app}'
    if payload.refund_of_id:
        notes += f'; refund of transaction #{payload.refund_of_id}'
    transaction = TransactionWriteIn(**(payload.model_dump(exclude={'add_anyway', 'remember', 'refund_of_id'}) | {'notes': notes}))
    tx = add_transaction(db, owner_id, transaction)
    row.status = 'approved'; row.transaction_id = tx.id
    if payload.remember:
        key = f'space:{row.space_id}' if row.space_id else 'personal'
        memory = db.query(BankMerchantMemory).filter_by(user_id=actor.id, scope_key=key, merchant_key=row.merchant.casefold(), kind=row.transaction_type).first()
        if not memory:
            memory = BankMerchantMemory(user_id=actor.id, scope_key=key, merchant_key=row.merchant.casefold(), kind=row.transaction_type); db.add(memory)
        memory.description = payload.description; memory.category_id = payload.category_id
    result = tx_payload(tx)
    db.commit()
    return {'status': 'approved', 'transaction_id': tx.id, 'transaction': result}


@router.post('/{item_id}/ignore')
def ignore(item_id: int, actor=Depends(workspace_actor), db=Depends(get_db)):
    row = candidate(db, actor, item_id)
    db.query(BankCandidate).filter_by(id=row.id, status='pending').update({'status': 'ignored'})
    db.commit()
    return {'saved': True}


@router.post('/{item_id}/restore')
def restore(item_id: int, actor=Depends(workspace_actor), db=Depends(get_db)):
    row = candidate(db, actor, item_id)
    db.query(BankCandidate).filter_by(id=row.id, status='ignored').update({'status': 'pending'})
    db.commit()
    return {'saved': True}


class RouteIn(BaseModel):
    wallet_id: int


@router.post('/{item_id}/route')
def route_alert(item_id: int, payload: RouteIn, actor=Depends(current_user), db=Depends(get_db)):
    row = db.query(BankCandidate).filter_by(id=item_id, user_id=actor.id, status='pending').with_for_update().first()
    if not row:
        raise HTTPException(404, 'Pending alert not found')
    wallet = accessible_wallet(db, actor, payload.wallet_id, write=True)
    row.wallet_id = wallet.id; row.space_id = wallet.space_id; row.category_id = None
    db.commit()
    return {'space_id': row.space_id}
