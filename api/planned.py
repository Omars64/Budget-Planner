"""Upcoming ledger entries. Plans never affect balances until posted."""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from .database import get_db
from .index import current_user
from .models import Category, PlannedTransaction, Transaction, User, Wallet, WalletShare
from .extensions import can_edit_wallet, share_for_wallet, shared_wallet_ids
from .schemas import TransactionIn
from .timekeeping import ledger_iso, now as ledger_now

router = APIRouter()


class PlanIn(BaseModel):
    transaction: TransactionIn
    status: Literal['planned', 'scheduled'] = 'planned'
    reminder_enabled: bool = True

    @field_validator('transaction',mode='before')
    @classmethod
    def no_scheduled_photo(cls,value):
        if isinstance(value,dict) and value.get('receipt'):
            raise ValueError('Reference images are supported when recording now, not scheduling.')
        return value


def access(db, user, wallet_id):
    wallet, permission, _ = share_for_wallet(db, user, wallet_id)
    return wallet, permission


def validate_plan(db, user, payload, existing=None):
    tx = payload.transaction
    if tx.recurring_frequency != 'none' or tx.recurring_until is not None:
        raise HTTPException(422, 'Schedule one transaction at a time; repeat is available for recorded transactions.')
    if payload.status == 'scheduled' and tx.date <= ledger_now():
        raise HTTPException(422, 'Choose a future date and time to schedule this transaction.')
    wallet, permission = access(db, user, tx.wallet_id)
    if permission not in ('add', 'edit') or (existing and permission != 'edit' and existing.created_by_id != user.id):
        raise HTTPException(403, 'You cannot add or edit plans for this wallet.')
    if tx.transfer_wallet_id:
        destination, dest_permission = access(db, user, tx.transfer_wallet_id)
        if destination.user_id != wallet.user_id or dest_permission not in ('add', 'edit'):
            raise HTTPException(403, 'Choose an accessible destination owned by the same person.')
    if tx.category_id:
        category = db.get(Category, tx.category_id)
        if not category or category.user_id != wallet.user_id or category.kind != tx.type:
            raise HTTPException(422, 'Choose a category belonging to this wallet and transaction type.')
    return wallet


def serialize(db, row, user):
    wallet = db.get(Wallet, row.wallet_id)
    owner = db.get(User, row.owner_id)
    category = db.get(Category, row.category_id) if row.category_id else None
    return {
        'id': row.id, 'type': row.type, 'amount': float(row.amount),
        'description': row.description, 'notes': row.notes, 'date': ledger_iso(row.due_at), 'reporting_month': row.reporting_month,
        'wallet_id': row.wallet_id, 'wallet_name': wallet.name if wallet else 'Deleted wallet',
        'transfer_wallet_id': row.transfer_wallet_id, 'category_id': row.category_id,
        'category_name': category.name if category else None,
        'owner_name': owner.username if owner else 'Former user',
        'shared': bool(wallet and wallet.user_id != user.id) or bool(wallet and db.query(WalletShare.id).filter_by(wallet_id=row.wallet_id).first()),
        'status': row.status, 'reminder_enabled': row.reminder_enabled,
        'posted_transaction_id': row.posted_transaction_id, 'error': row.error,
        'can_edit': bool(wallet and (wallet.user_id == user.id or row.created_by_id == user.id or can_edit_wallet(db, user, row.wallet_id))),
    }


def post_due(db: Session, limit=100):
    """Claim each due row inside a transaction; concurrent workers skip locked rows."""
    query = db.query(PlannedTransaction).filter(
        PlannedTransaction.status == 'scheduled', PlannedTransaction.due_at <= ledger_now()
    ).order_by(PlannedTransaction.due_at, PlannedTransaction.id)
    if db.bind.dialect.name == 'postgresql':
        query = query.with_for_update(skip_locked=True)
    rows = query.limit(limit).all()
    posted = 0
    for row in rows:
        source = db.get(Wallet, row.wallet_id)
        destination = db.get(Wallet, row.transfer_wallet_id) if row.transfer_wallet_id else None
        category = db.get(Category, row.category_id) if row.category_id else None
        creator = db.get(User, row.created_by_id)
        share = db.query(WalletShare).filter_by(wallet_id=row.wallet_id, member_user_id=row.created_by_id).first() if creator and row.created_by_id != row.owner_id else None
        destination_share = db.query(WalletShare).filter_by(wallet_id=row.transfer_wallet_id, member_user_id=row.created_by_id).first() if creator and row.transfer_wallet_id and row.created_by_id != row.owner_id else None
        allowed = bool(creator and creator.active and (creator.id == row.owner_id or share and share.permission in {'add', 'edit'}) and (not row.transfer_wallet_id or creator.id == row.owner_id or destination_share and destination_share.permission in {'add', 'edit'}))
        if not allowed or not source or source.user_id != row.owner_id or source.archived or (row.transfer_wallet_id and (not destination or destination.user_id != row.owner_id or destination.archived)) or (row.category_id and (not category or category.user_id != row.owner_id or category.kind != row.type)):
            row.status = 'failed'; row.error = 'Wallet, category, or access changed. Review and reschedule this entry.'
            continue
        tx = Transaction(user_id=row.owner_id, recorded_by_id=row.created_by_id,
                         type=row.type, amount=row.amount, description=row.description,
                         notes=row.notes, date=row.due_at, wallet_id=row.wallet_id,
                         reporting_month=row.reporting_month,
                         transfer_wallet_id=row.transfer_wallet_id, category_id=row.category_id,
                         recurring_frequency='none')
        db.add(tx); db.flush()
        row.posted_transaction_id = tx.id
        row.status = 'posted'; row.error = None
        from .update_push import queue_scheduled
        queue_scheduled(db, row)
        posted += 1
    db.commit()
    return posted


@router.get('/api/planned-transactions')
def list_plans(status: str = Query('all', pattern='^(all|planned|scheduled|posted|failed)$'), user: User = Depends(current_user), db: Session = Depends(get_db)):
    post_due(db)
    ids = shared_wallet_ids(db, user) | {w.id for w in db.query(Wallet).filter_by(user_id=user.id).all()}
    if not ids:
        return []
    query = db.query(PlannedTransaction).filter(PlannedTransaction.wallet_id.in_(ids))
    if status != 'all':
        query = query.filter(PlannedTransaction.status == status)
    return [serialize(db, row, user) for row in query.order_by(PlannedTransaction.due_at, PlannedTransaction.id).limit(1000).all()]


@router.post('/api/planned-transactions', status_code=201)
def create_plan(payload: PlanIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    wallet = validate_plan(db, user, payload)
    tx = payload.transaction
    row = PlannedTransaction(owner_id=wallet.user_id, created_by_id=user.id, wallet_id=tx.wallet_id,
        transfer_wallet_id=tx.transfer_wallet_id, category_id=tx.category_id, type=tx.type,
        amount=tx.amount, description=tx.description, notes=tx.notes, due_at=tx.date,
        reporting_month=tx.reporting_month,
        status=payload.status, reminder_enabled=payload.reminder_enabled)
    db.add(row); db.commit(); db.refresh(row)
    return serialize(db, row, user)


@router.put('/api/planned-transactions/{plan_id}')
def update_plan(plan_id: int, payload: PlanIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = db.query(PlannedTransaction).filter_by(id=plan_id).with_for_update().first()
    if not row: raise HTTPException(404, 'Planned entry not found')
    if row.status == 'posted': raise HTTPException(409, 'This entry has already been recorded. Edit the transaction instead.')
    access(db, user, row.wallet_id)
    if row.created_by_id != user.id and row.owner_id != user.id and not can_edit_wallet(db, user, row.wallet_id):
        raise HTTPException(403, 'You cannot edit this entry.')
    wallet = validate_plan(db, user, payload, row)
    tx = payload.transaction
    row.owner_id = wallet.user_id
    for key, value in [('wallet_id', tx.wallet_id), ('transfer_wallet_id', tx.transfer_wallet_id),
        ('category_id', tx.category_id), ('type', tx.type), ('amount', tx.amount),
        ('description', tx.description), ('notes', tx.notes), ('due_at', tx.date),
        ('reporting_month', tx.reporting_month),
        ('status', payload.status), ('reminder_enabled', payload.reminder_enabled)]:
        setattr(row, key, value)
    row.error = None
    db.commit(); db.refresh(row)
    return serialize(db, row, user)


@router.delete('/api/planned-transactions/{plan_id}', status_code=204)
def delete_plan(plan_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = db.query(PlannedTransaction).filter_by(id=plan_id).with_for_update().first()
    if not row: raise HTTPException(404, 'Planned entry not found')
    access(db, user, row.wallet_id)
    if row.created_by_id != user.id and row.owner_id != user.id and not can_edit_wallet(db, user, row.wallet_id):
        raise HTTPException(403, 'You cannot delete this entry.')
    if row.status == 'posted': raise HTTPException(409, 'This entry has already been recorded.')
    db.delete(row); db.commit()
