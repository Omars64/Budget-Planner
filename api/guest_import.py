"""Add a guest workspace atomically; never restore over an existing account."""
import json
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, ValidationError, model_validator
from sqlalchemy.orm import Session

from .database import get_db
from .index import current_user
from .models import Budget, Category, Transaction, User, Wallet
from .schemas import BudgetIn, CategoryIn, TransactionIn, WalletIn
from .idempotency import reserve
from .ledger_accounting import set_opening_balance
from .timekeeping import ledger_time
from .account_security import audit

router = APIRouter()


class GuestWallet(WalletIn):
    id: int = Field(gt=0)
    opening_date: datetime


class GuestCategory(CategoryIn):
    id: int = Field(gt=0)


class GuestTransaction(TransactionIn):
    id: int = Field(gt=0)
    notes: str = Field(default='', max_length=10000)


class GuestBudget(BudgetIn):
    id: int = Field(gt=0)


class GuestImport(BaseModel):
    workspace_id: UUID
    revision: int = Field(ge=0)
    currency: str = Field(pattern=r'^[A-Z]{3}$')
    wallets: list[GuestWallet] = Field(max_length=200)
    categories: list[GuestCategory] = Field(max_length=500)
    transactions: list[GuestTransaction] = Field(max_length=20000)
    budgets: list[GuestBudget] = Field(max_length=2000)

    @model_validator(mode='after')
    def valid_references(self):
        for rows in [self.wallets, self.categories, self.transactions, self.budgets]:
            if len({r.id for r in rows}) != len(rows):
                raise ValueError('Guest record identifiers must be unique')
        wallets = {w.id for w in self.wallets}
        categories = {c.id: c.kind for c in self.categories}
        for tx in self.transactions:
            if tx.wallet_id not in wallets or (tx.transfer_wallet_id is not None and tx.transfer_wallet_id not in wallets):
                raise ValueError('Guest transaction references a missing wallet')
            if tx.category_id is not None and categories.get(tx.category_id) != tx.type:
                raise ValueError('Guest transaction category does not match')
            if tx.recurring_frequency != 'none' or tx.recurring_until:
                raise ValueError('Guest transactions cannot repeat')
        for budget in self.budgets:
            if budget.category_id is not None and categories.get(budget.category_id) != 'expense':
                raise ValueError('Guest budget references a missing expense category')
        return self


async def read_import(request: Request):
    maximum = 10_000_000
    raw = bytearray()
    async for chunk in request.stream():
        if len(raw) + len(chunk) > maximum:
            raise HTTPException(413, 'This guest workspace is too large to import at once. Your local records have been kept.')
        raw.extend(chunk)
    try:
        return GuestImport.model_validate_json(raw)
    except ValidationError as error:
        details = [{'loc': ['body', *item['loc']], 'msg': item['msg'], 'type': item['type']} for item in error.errors(include_context=False, include_input=False)]
        raise HTTPException(422, details)


@router.post('/api/guest/import')
def import_guest(user: User = Depends(current_user), payload: GuestImport = Depends(read_import), db: Session = Depends(get_db)):
    from .index import setting
    if payload.currency != setting(db, user.id, 'currency', 'KWD'):
        raise HTTPException(409, 'Guest and account currencies differ. No records were imported. Match your account currency first; amounts are not converted automatically.')
    # A server-derived key prevents duplicate imports even after a lost response.
    receipt, previous = reserve(db, user.id, 'guest-import', str(payload.workspace_id), payload)
    if previous is not None:
        return previous
    try:
        wallet_map, category_map = {}, {}
        for c in payload.categories:
            row = db.query(Category).filter_by(user_id=user.id, name=c.name, kind=c.kind).first()
            if not row:
                row = Category(user_id=user.id, **c.model_dump(exclude={'id'}))
                db.add(row); db.flush()
            category_map[c.id] = row.id
        for w in payload.wallets:
            row = Wallet(user_id=user.id, **w.model_dump(exclude={'id', 'opening_date', 'initial_balance'}), initial_balance=0, created_at=ledger_time(w.opening_date))
            db.add(row); db.flush()
            set_opening_balance(db, row, w.initial_balance, user.id)
            wallet_map[w.id] = row.id
        for tx in payload.transactions:
            values = tx.model_dump(exclude={'id'})
            values.update(wallet_id=wallet_map[tx.wallet_id], transfer_wallet_id=wallet_map.get(tx.transfer_wallet_id), category_id=category_map.get(tx.category_id))
            db.add(Transaction(user_id=user.id, recorded_by_id=user.id, **values))
        for budget in payload.budgets:
            values = budget.model_dump(exclude={'id'})
            values['category_id'] = category_map.get(budget.category_id)
            db.add(Budget(user_id=user.id, **values))
        result = { 'wallets': len(payload.wallets), 'transactions': len(payload.transactions), 'budgets': len(payload.budgets), 'wallet_map': wallet_map, 'category_map': category_map }
        receipt.response = json.dumps(result)
        audit(db, user.id, user.id, 'Imported guest records', str(payload.workspace_id))
        db.commit()
        return result
    except Exception:
        db.rollback()
        raise
