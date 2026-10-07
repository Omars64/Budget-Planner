"""Explain wallet balances and record optional, non-mutating balance checks."""
import json
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import and_, case, func, or_
from sqlalchemy.orm import Session, joinedload

from .database import get_db
from .idempotency import reserve
from .spaces import workspace_actor
from .index import current_user, materialize_recurring_for_user, setting, wallet_balance
from .models import Transaction, User, WalletBalanceCheck
from .timekeeping import ledger_iso, now as ledger_now


router = APIRouter()


class BalanceCheckIn(BaseModel):
    observed_balance: Decimal = Field(max_digits=16, decimal_places=3)
    note: str = Field(default='', max_length=240)


class BalanceCheckArchive(BaseModel):
    wallet_id: int
    expected_balance: Decimal = Field(max_digits=16, decimal_places=3)
    observed_balance: Decimal = Field(max_digits=16, decimal_places=3)
    currency: str = Field(min_length=1, max_length=8)
    note: str = Field(default='', max_length=240)
    checked_by_name: str = Field(min_length=1, max_length=80)
    checked_at: datetime

    def stored_time(self):
        return self.checked_at.astimezone(timezone.utc).replace(tzinfo=None) if self.checked_at.tzinfo else self.checked_at


def accessible_wallet(db, user, wallet_id):
    from .extensions import share_for_wallet

    wallet, permission, _ = share_for_wallet(db, user, wallet_id)
    return wallet, permission == 'edit'


def check_payload(row, actors):
    actor = actors.get(row.checked_by_id)
    difference = row.observed_balance - row.expected_balance
    return {
        'id': row.id,
        'expected_balance': float(row.expected_balance),
        'observed_balance': float(row.observed_balance),
        'difference': float(difference),
        'matches': difference == 0,
        'currency': row.currency,
        'note': row.note,
        'checked_at': row.checked_at.isoformat() + 'Z',
        'checked_by': actor.username if actor else row.checked_by_name,
    }


@router.get('/api/ledger/wallets/{wallet_id}')
def wallet_ledger(
    wallet_id: int,
    before_date: Optional[str] = None,
    before_id: Optional[int] = Query(None, gt=0),
    limit: int = Query(40, ge=1, le=100),
    user: User = Depends(workspace_actor),
    db: Session = Depends(get_db),
):
    wallet, can_check = accessible_wallet(db, user, wallet_id)
    if bool(before_date) != bool(before_id):
        raise HTTPException(422, 'Both cursor fields are required')
    cursor_date = None
    if before_date:
        from datetime import datetime

        try:
            cursor_date = datetime.fromisoformat(before_date)
        except ValueError:
            raise HTTPException(422, 'Invalid ledger cursor')
        if cursor_date.tzinfo is not None:
            raise HTTPException(422, 'Invalid ledger cursor')

    materialize_recurring_for_user(db, wallet.user_id)
    affected = or_(Transaction.wallet_id == wallet.id, Transaction.transfer_wallet_id == wallet.id)
    change = case(
        (Transaction.type == 'income', Transaction.amount),
        (Transaction.type == 'expense', -Transaction.amount),
        (Transaction.wallet_id == wallet.id, -Transaction.amount),
        else_=Transaction.amount,
    )
    running = func.sum(change).over(order_by=(Transaction.date, Transaction.id), rows=(None, 0))
    balances = db.query(Transaction.id.label('transaction_id'), running.label('running')).filter(affected).subquery()
    query = db.query(Transaction, balances.c.running).join(balances, balances.c.transaction_id == Transaction.id).options(
        joinedload(Transaction.wallet), joinedload(Transaction.transfer_wallet), joinedload(Transaction.category)
    )
    if cursor_date is not None:
        query = query.filter(or_(Transaction.date < cursor_date, and_(Transaction.date == cursor_date, Transaction.id < before_id)))
    found = query.order_by(Transaction.date.desc(), Transaction.id.desc()).limit(limit + 1).all()
    rows = found[:limit]
    actor_ids = {tx.recorded_by_id for tx, _ in rows if tx.recorded_by_id}
    actors = {actor.id: actor for actor in db.query(User).filter(User.id.in_(actor_ids)).all()} if actor_ids else {}
    from .extensions import shared_wallet_ids

    visible_wallets = shared_wallet_ids(db, user) if wallet.user_id != user.id else None
    entries = []
    for tx, cumulative in rows:
        delta = change_for_wallet(tx, wallet.id)
        other = tx.transfer_wallet if tx.wallet_id == wallet.id else tx.wallet
        other_visible = other and (wallet.user_id == user.id or other.id in visible_wallets)
        entries.append({
            'id': tx.id,
            'date': ledger_iso(tx.date),
            'description': tx.description,
            'category': tx.category.name if tx.category else None,
            'type': tx.type,
            'change': float(delta),
            'balance_after': float(wallet.initial_balance + cumulative),
            'counterparty': other.name if tx.type == 'transfer' and other_visible else ('Another wallet' if tx.type == 'transfer' else None),
            'recorded_by': actors[tx.recorded_by_id].username if tx.recorded_by_id in actors else None,
            'is_opening_balance': tx.is_opening_balance,
            'is_future_dated': tx.date > ledger_now(),
        })
    next_cursor = {'before_date': rows[-1][0].date.isoformat(), 'before_id': rows[-1][0].id} if len(found) > limit else None
    return {
        'wallet_id': wallet.id,
        'wallet_name': wallet.name,
        'currency': setting(db, wallet.user_id, 'currency', 'KWD'),
        'balance': wallet_balance(db, wallet),
        'can_check': can_check,
        'entries': entries,
        'next_cursor': next_cursor,
    }


def change_for_wallet(tx, wallet_id):
    if tx.type == 'income':
        return tx.amount
    if tx.type == 'expense' or tx.wallet_id == wallet_id:
        return -tx.amount
    return tx.amount


@router.get('/api/ledger/wallets/{wallet_id}/checks')
def balance_checks(
    wallet_id: int,
    before_id: Optional[int] = Query(None, gt=0),
    limit: int = Query(20, ge=1, le=100),
    user: User = Depends(workspace_actor),
    db: Session = Depends(get_db),
):
    accessible_wallet(db, user, wallet_id)
    query = db.query(WalletBalanceCheck).filter_by(wallet_id=wallet_id)
    if before_id is not None:
        query = query.filter(WalletBalanceCheck.id < before_id)
    found = query.order_by(WalletBalanceCheck.id.desc()).limit(limit + 1).all()
    rows = found[:limit]
    actor_ids = {row.checked_by_id for row in rows if row.checked_by_id}
    actors = {actor.id: actor for actor in db.query(User).filter(User.id.in_(actor_ids)).all()} if actor_ids else {}
    return {'checks': [check_payload(row, actors) for row in rows], 'next_cursor': rows[-1].id if len(found) > limit else None}


@router.post('/api/ledger/wallets/{wallet_id}/checks', status_code=201)
def create_balance_check(
    wallet_id: int,
    payload: BalanceCheckIn,
    request: Request,
    user: User = Depends(workspace_actor),
    db: Session = Depends(get_db),
):
    wallet, can_check = accessible_wallet(db, user, wallet_id)
    if not can_check:
        raise HTTPException(403, 'Only an owner or editor can check this balance')
    materialize_recurring_for_user(db, wallet.user_id)
    receipt, previous = reserve(db, user.id, f'balance-check:{wallet_id}', request.headers.get('Idempotency-Key'), payload)
    if previous is not None:
        return previous
    row = WalletBalanceCheck(
        wallet_id=wallet.id,
        checked_by_id=user.id,
        checked_by_name=user.username,
        expected_balance=Decimal(str(wallet_balance(db, wallet))),
        observed_balance=payload.observed_balance,
        currency=setting(db, wallet.user_id, 'currency', 'KWD'),
        note=payload.note.strip(),
    )
    db.add(row)
    db.flush()
    result = check_payload(row, {user.id: user})
    if receipt:
        receipt.response = json.dumps(result)
    from .account_security import audit

    audit(db, wallet.user_id, user.id, 'Checked wallet balance', f'wallet:{wallet.id}')
    db.commit()
    return result
