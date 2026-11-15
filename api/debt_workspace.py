"""Account-owned debt schedules, independent of the selected shared Space."""
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator
from sqlalchemy.orm import Session

from .auth_dependency import current_user
from .coordination import lock_owners
from .database import get_db
from .ledger_accounting import personal_records
from .models import AppSetting, Transaction, User, Wallet
from .timekeeping import ledger_iso, today

KEY = 'debt_workspace_v1'
router = APIRouter(prefix='/api/debt-workspace')
Amount = Annotated[int, Field(strict=True, gt=0, le=10**11)]
Month = Annotated[str, StringConstraints(pattern=r'^(?:19|20|21)\d{2}-(?:0[1-9]|1[0-2])$')]


class Record(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True, allow_inf_nan=False)


class Payment(Record):
    id: UUID
    amount: Amount
    date: date
    note: str = Field(default='', max_length=240)
    transaction_id: int | None = Field(default=None, gt=0)


class Instalment(Record):
    id: UUID
    month: Month
    due: date
    amount: Amount
    payments: list[Payment] = Field(default_factory=list, max_length=60)

    @model_validator(mode='after')
    def validate_paid(self):
        if not 1900 <= self.due.year <= 2199:
            raise ValueError('Due date is outside the supported range')
        if sum(payment.amount for payment in self.payments) > self.amount:
            raise ValueError('Payments exceed the scheduled amount')
        if any(not date(1900, 1, 1) <= payment.date <= today() for payment in self.payments):
            raise ValueError('Enter the date the money moved')
        return self


class DebtRecord(Record):
    id: UUID
    name: str = Field(min_length=1, max_length=120)
    person: str = Field(default='', max_length=120)
    kind: Literal['loan', 'borrowed', 'lent']
    opening: Amount
    apr: float = Field(default=0, ge=0, le=100)
    note: str = Field(default='', max_length=500)
    reminder: Literal[0, 1, 3, 7, 14] | None = None
    items: list[Instalment] = Field(min_length=1, max_length=120)

    @model_validator(mode='after')
    def validate_schedule(self):
        if len({item.month for item in self.items}) != len(self.items):
            raise ValueError('Each payment month must be unique')
        scheduled = sum(item.amount for item in self.items)
        if scheduled < self.opening or (self.apr == 0 and scheduled != self.opening):
            raise ValueError('Schedule does not match the opening balance')
        if self.apr and self.kind != 'loan':
            raise ValueError('Only loans can have interest')
        return self


class Workspace(Record):
    revision: int = Field(default=0, ge=0)
    enabled: bool = True
    currency: Annotated[str, StringConstraints(pattern=r'^[A-Z]{3}$')] | None = None
    records: list[DebtRecord] = Field(default_factory=list, max_length=100)

    @model_validator(mode='after')
    def validate_references(self):
        seen = set()
        linked = set()
        for record in self.records:
            for item in [record, *record.items, *(p for i in record.items for p in i.payments)]:
                if item.id in seen:
                    raise ValueError('Duplicate debt record identifier')
                seen.add(item.id)
                if isinstance(item, Payment) and item.transaction_id:
                    if item.transaction_id in linked:
                        raise ValueError('A transaction can be linked only once')
                    linked.add(item.transaction_id)
        return self


def load_workspace(db, user_id):
    row = db.get(AppSetting, (user_id, KEY), populate_existing=True)
    return row, Workspace.model_validate_json(row.value) if row else Workspace()


def linked_payments(workspace):
    return {p.transaction_id: (r, p) for r in workspace.records
            for i in r.items for p in i.payments if p.transaction_id}


def personal_entries(db, user_id):
    return personal_records(db, user_id).join(Wallet, Wallet.id == Transaction.wallet_id).filter(
        Wallet.space_id.is_(None), Transaction.is_opening_balance.is_(False))


@router.get('')
def read_workspace(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return load_workspace(db, user.id)[1]


@router.get('/linkable')
def linkable(direction: Literal['income', 'expense'], day: date, amount: Annotated[int, Query(gt=0, le=10**11)],
             user: User = Depends(current_user), db: Session = Depends(get_db)):
    if not date(1900, 1, 1) <= day <= today():
        raise HTTPException(422, 'Choose the date the money moved.')
    start = datetime.combine(day, time.min)
    end = start + timedelta(days=1)
    existing = linked_payments(load_workspace(db, user.id)[1])
    query = personal_entries(db, user.id).filter(Transaction.type == direction,
        Transaction.amount == Decimal(amount) / 1000, Transaction.date >= start, Transaction.date < end)
    if existing:
        query = query.filter(Transaction.id.notin_(existing))
    return [{'id': row.id, 'description': row.description} for row in query.order_by(Transaction.id.desc()).limit(30)]


@router.put('')
def save_workspace(payload: Workspace, user: User = Depends(current_user), db: Session = Depends(get_db)):
    lock_owners(db, user.id)
    row, current = load_workspace(db, user.id)
    if current.revision != payload.revision:
        raise HTTPException(409, 'Debts changed on another device. Refresh and try again.')
    if current.records and current.currency != payload.currency:
        raise HTTPException(422, 'The debt workspace currency is already set.')
    old_links = linked_payments(current)
    for txid, (record, payment) in linked_payments(payload).items():
        previous = old_links.get(txid)
        if previous and previous[0].id == record.id and previous[1] == payment:
            continue
        entry = personal_entries(db, user.id).filter(Transaction.id == txid).first()
        currency = db.get(AppSetting, (user.id, 'currency'), populate_existing=True)
        direction = 'income' if record.kind == 'lent' else 'expense'
        if (not entry or payload.currency != (currency.value if currency else 'KWD') or
                entry.type != direction or entry.amount != Decimal(payment.amount) / 1000
                or ledger_iso(entry.date)[:10] != payment.date.isoformat()):
            raise HTTPException(422, 'Choose a matching transaction from your Personal workspace.')
    payload.revision += 1
    value = payload.model_dump_json()
    if len(value.encode()) > 800000:
        raise HTTPException(413, 'Debt workspace has reached its storage limit.')
    if row:
        row.value = value
    else:
        db.add(AppSetting(user_id=user.id, key=KEY, value=value))
    db.commit()
    return payload
