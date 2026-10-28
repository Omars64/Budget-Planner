"""Upcoming ledger entries. Plans never affect balances until posted."""
import hashlib
import json
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from .database import get_db
from .spaces import workspace_actor
from .models import Category, PlannedTransaction, Transaction, User, Wallet, WalletShare
from .extensions import share_for_wallet, shared_wallet_ids
from .schemas import TransactionIn
from .timekeeping import ledger_iso, now as ledger_now
from .coordination import lock_owners, lock_wallet_owners, lock_record
from .idempotency import reserve

router = APIRouter()


class PlanIn(BaseModel):
    transaction: TransactionIn
    status: Literal['planned', 'scheduled'] = 'planned'
    reminder_enabled: bool = True
    revision: str | None = None

    @field_validator('transaction',mode='before')
    @classmethod
    def no_scheduled_photo(cls,value):
        if isinstance(value,dict) and value.get('receipt'):
            raise ValueError('Reference images are supported when recording now, not scheduling.')
        return value


def access(db, user, wallet_id):
    wallet, permission, _ = share_for_wallet(db, user, wallet_id)
    return wallet, permission


def can_change_plan(db, user, row):
    for wallet_id in (row.wallet_id, row.transfer_wallet_id):
        if wallet_id is None:
            continue
        try:
            _, permission = access(db, user, wallet_id)
        except HTTPException as error:
            if error.status_code not in (403, 404):
                raise
            return False
        if permission != 'edit' and not (permission == 'add' and row.created_by_id == user.id):
            return False
    return True


def plan_revision(row):
    values = [str(getattr(row, column.name)) for column in PlannedTransaction.__table__.columns]
    return hashlib.sha256(json.dumps(values).encode()).hexdigest()


def check_plan_revision(request, row, revision=None, required=True):
    expected = request.headers.get('If-Match') or revision
    if not expected:
        if required:
            raise HTTPException(409, 'Update or refresh Budgetly, then reopen this planned entry before editing it.')
        return
    if expected != plan_revision(row):
        raise HTTPException(409, 'This planned entry changed on another device. Your draft is kept; reload the latest entry before saving.')


def validate_plan(db, user, payload, existing=None):
    tx = payload.transaction
    lock_wallet_owners(db, tx.wallet_id, tx.transfer_wallet_id)
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
        'revision': plan_revision(row),
        'id': row.id, 'type': row.type, 'amount': float(row.amount),
        'description': row.description, 'notes': row.notes, 'date': ledger_iso(row.due_at), 'reporting_month': row.reporting_month,
        'wallet_id': row.wallet_id, 'wallet_name': wallet.name if wallet else 'Deleted wallet',
        'transfer_wallet_id': row.transfer_wallet_id, 'category_id': row.category_id,
        'category_name': category.name if category else None,
        'owner_name': owner.username if owner else 'Former user',
        'shared': bool(wallet and wallet.user_id != user.id) or bool(wallet and db.query(WalletShare.id).filter_by(wallet_id=row.wallet_id).first()),
        'status': row.status, 'reminder_enabled': row.reminder_enabled,
        'posted_transaction_id': row.posted_transaction_id, 'error': row.error,
        'can_edit': bool(wallet and can_change_plan(db, user, row)),
    }


def post_due(db: Session, limit=100):
    """Claim each due row inside a transaction; concurrent workers skip locked rows."""
    query = db.query(PlannedTransaction).filter(
        PlannedTransaction.status == 'scheduled', PlannedTransaction.due_at <= ledger_now()
    ).order_by(PlannedTransaction.due_at, PlannedTransaction.id)
    candidates = query.with_entities(PlannedTransaction.id, PlannedTransaction.owner_id,
                                     PlannedTransaction.created_by_id).limit(limit).all()
    if not candidates:
        return 0
    lock_owners(db, *(ident for row in candidates for ident in (row.owner_id, row.created_by_id)))
    query = query.filter(PlannedTransaction.id.in_([row.id for row in candidates]),
                         PlannedTransaction.owner_id.in_([row.owner_id for row in candidates]),
                         PlannedTransaction.created_by_id.in_([row.created_by_id for row in candidates])).populate_existing()
    if db.get_bind().dialect.name == 'postgresql':
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
        if source and source.space_id is not None and creator and creator.active:
            from .spaces import space_wallet_permission
            try:
                allowed = space_wallet_permission(db, source, creator) == 'edit' and (
                    not row.transfer_wallet_id or bool(destination and destination.space_id == source.space_id and space_wallet_permission(db, destination, creator) == 'edit'))
            except HTTPException:
                allowed = False
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
def list_plans(status: str = Query('all', pattern='^(all|planned|scheduled|posted|failed)$'), user: User = Depends(workspace_actor), db: Session = Depends(get_db)):
    post_due(db)
    ids = shared_wallet_ids(db, user) | {w.id for w in db.query(Wallet).filter_by(user_id=user.id).all()}
    if not ids:
        return []
    query = db.query(PlannedTransaction).filter(PlannedTransaction.wallet_id.in_(ids))
    if status != 'all':
        query = query.filter(PlannedTransaction.status == status)
    return [serialize(db, row, user) for row in query.order_by(PlannedTransaction.due_at, PlannedTransaction.id).limit(1000).all()]


@router.post('/api/planned-transactions', status_code=201)
def create_plan(payload: PlanIn, request: Request, user: User = Depends(workspace_actor), db: Session = Depends(get_db)):
    # Authorize before replay, but allow a committed request to replay after its due time.
    lock_wallet_owners(db, payload.transaction.wallet_id, payload.transaction.transfer_wallet_id)
    for wallet_id in (payload.transaction.wallet_id, payload.transaction.transfer_wallet_id):
        if wallet_id is not None and access(db, user, wallet_id)[1] not in ('add', 'edit'):
            raise HTTPException(403, 'You cannot add or edit plans for this wallet.')
    receipt, previous = reserve(db, user.id, 'planned-transaction', request.headers.get('Idempotency-Key'), payload.model_copy(update={'revision': None}))
    if previous is not None:
        return previous
    wallet = validate_plan(db, user, payload)
    tx = payload.transaction
    row = PlannedTransaction(owner_id=wallet.user_id, created_by_id=user.id, wallet_id=tx.wallet_id,
        transfer_wallet_id=tx.transfer_wallet_id, category_id=tx.category_id, type=tx.type,
        amount=tx.amount, description=tx.description, notes=tx.notes, due_at=tx.date,
        reporting_month=tx.reporting_month,
        status=payload.status, reminder_enabled=payload.reminder_enabled)
    db.add(row); db.flush(); db.refresh(row)
    result = serialize(db, row, user)
    if receipt:
        receipt.response = json.dumps(result)
    db.commit()
    return result


@router.put('/api/planned-transactions/{plan_id}')
def update_plan(plan_id: int, payload: PlanIn, request: Request, user: User = Depends(workspace_actor), db: Session = Depends(get_db)):
    row = lock_record(db, PlannedTransaction, plan_id, (payload.transaction.wallet_id, payload.transaction.transfer_wallet_id))
    if not row: raise HTTPException(404, 'Planned entry not found')
    if row.status == 'posted': raise HTTPException(409, 'This entry has already been recorded. Edit the transaction instead.')
    if not can_change_plan(db, user, row):
        raise HTTPException(403, 'You cannot edit this entry.')
    check_plan_revision(request, row, payload.revision)
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
def delete_plan(plan_id: int, request: Request, user: User = Depends(workspace_actor), db: Session = Depends(get_db)):
    row = lock_record(db, PlannedTransaction, plan_id)
    if not row: raise HTTPException(404, 'Planned entry not found')
    if not can_change_plan(db, user, row):
        raise HTTPException(403, 'You cannot delete this entry.')
    if row.status == 'posted': raise HTTPException(409, 'This entry has already been recorded.')
    check_plan_revision(request, row, required=False)
    db.delete(row); db.commit()
