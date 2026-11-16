"""Account-owned debt schedules, independent of the selected shared Space."""
import json
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import Annotated, Literal
from uuid import NAMESPACE_URL, UUID, uuid4, uuid5

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from .auth_dependency import current_user
from .coordination import lock_owners
from .currency import CURRENCY_CODES, currency_digits
from .database import get_db
from .idempotency import reserve
from .ledger_accounting import personal_records
from .models import AppSetting, DebtSpace, DebtSpaceAlert, DebtSpaceMember, Transaction, User, Wallet
from .spaces import MemberIn
from .timekeeping import ledger_iso, today

KEY = 'debt_workspace_v1'
router = APIRouter(prefix='/api/debt-workspace')
Amount = Annotated[int, Field(strict=True, gt=0, le=10**11)]
ScheduledAmount = Annotated[int, Field(strict=True, ge=0, le=10**11)]
Month = Annotated[str, StringConstraints(pattern=r'^(?:19|20|21)\d{2}-(?:0[1-9]|1[0-2])$')]
Reminder = Literal[0, 1, 3, 7, 14] | None


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
    amount: ScheduledAmount
    payments: list[Payment] = Field(default_factory=list, max_length=60)
    covered_by: Month | None = None

    @model_validator(mode='after')
    def validate_paid(self):
        if not 1900 <= self.due.year <= 2199:
            raise ValueError('Due date is outside the supported range')
        paid = sum(payment.amount for payment in self.payments)
        if paid > self.amount:
            raise ValueError('Payments exceed the scheduled amount')
        if self.covered_by:
            if self.covered_by >= self.month or paid != self.amount:
                raise ValueError('An extra payment must cover a later remaining balance')
        elif self.amount == 0:
            raise ValueError('Enter an amount for the instalment')
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
    reminder: Reminder = None
    items: list[Instalment] = Field(min_length=1, max_length=120)

    @model_validator(mode='after')
    def validate_schedule(self):
        if len({item.month for item in self.items}) != len(self.items):
            raise ValueError('Each payment month must be unique')
        paid_months = {item.month for item in self.items if item.payments}
        if any(item.covered_by and item.covered_by not in paid_months for item in self.items):
            raise ValueError('The extra payment must exist in the same repayment schedule')
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


class DebtSpaceName(Record):
    name: str = Field(min_length=1, max_length=40)


class SharedSpaceIn(DebtSpaceName):
    currency: Annotated[str, StringConstraints(pattern=r'^[A-Z]{3}$')]


class DebtSpaceDelete(Record):
    confirmation_name: Annotated[str, StringConstraints(strip_whitespace=False, min_length=1, max_length=40)]


class DebtAlerts(Record):
    enabled: bool = True
    rules: dict[UUID, Reminder] = Field(default_factory=dict, max_length=100)


class DebtSpaceArchive(Record):
    id: UUID
    name: str = Field(min_length=1, max_length=40)
    workspace: Workspace

    @model_validator(mode='after')
    def validate_scope(self):
        if self.workspace.currency not in CURRENCY_CODES or linked_payments(self.workspace):
            raise ValueError('Invalid shared debt data')
        if len(self.workspace.model_dump_json().encode()) > 800000:
            raise ValueError('Shared debt archive exceeds the storage limit')
        return self


class NewPayment(Record):
    revision: int = Field(ge=0)
    record_id: UUID
    item_id: UUID
    payment: Payment


def load_workspace(db, user_id):
    row = db.get(AppSetting, (user_id, KEY), populate_existing=True)
    return row, Workspace.model_validate_json(row.value) if row else Workspace()


def export_debt_spaces(db, owner_id):
    return [{'id': row.id, 'name': row.name, 'workspace': json.loads(row.value)}
            for row in db.query(DebtSpace).filter_by(owner_id=owner_id).order_by(DebtSpace.id)]


def restore_debt_spaces(db, owner_id, archives):
    if not archives:
        return
    owned = {row.id: row for row in db.query(DebtSpace).filter_by(owner_id=owner_id)}
    mapped = {}
    for archive in archives:
        ident = str(archive.id)
        target = ident if ident in owned else str(uuid5(NAMESPACE_URL, f'budgetly:debt-restore:{owner_id}:{ident}'))
        if target in mapped:
            raise HTTPException(400, 'Backup contains duplicate debt spaces.')
        mapped[target] = archive
    if len(owned.keys() | mapped.keys()) > 50:
        raise HTTPException(422, 'Restoring this backup would exceed 50 shared debt spaces.')
    for ident, archive in mapped.items():
        row = owned.get(ident)
        if row:
            current = Workspace.model_validate_json(row.value)
            archive.workspace.revision = max(current.revision, archive.workspace.revision) + 1
            row.name = archive.name
            row.value = archive.workspace.model_dump_json()
        else:
            # Restoring records never grants access or copies anyone else's preferences.
            archive.workspace.revision = 0
            db.add(DebtSpace(id=ident, owner_id=owner_id, name=archive.name, value=archive.workspace.model_dump_json()))


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
    return store_workspace(db, row, current, payload, user)


def store_workspace(db, row, current, payload, user, *, shared=False):
    if current.revision != payload.revision:
        raise HTTPException(409, 'Debts changed on another device. Refresh and try again.')
    if current.records and current.currency != payload.currency:
        raise HTTPException(422, 'The debt workspace currency is already set.')
    links = linked_payments(payload)
    if shared and links:
        raise HTTPException(422, 'Personal transactions can only be linked to private debts.')
    old_links = linked_payments(current)
    for txid, (record, payment) in links.items():
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


def member_match(user):
    return or_(DebtSpaceMember.member_user_id == user.id, and_(
        DebtSpaceMember.member_user_id.is_(None), DebtSpaceMember.email == user.email.lower()))


def remove_pending_debt_invitations(db, email):
    db.query(DebtSpaceMember).filter_by(email=email, member_user_id=None).delete(synchronize_session=False)


def accessible_spaces(db, user):
    grants = db.query(DebtSpaceMember.space_id).filter(member_match(user))
    return db.query(DebtSpace).filter(or_(DebtSpace.owner_id == user.id, DebtSpace.id.in_(grants)))


def shared_access(db, ident, user, *, write=False, owner_only=False, changing_alerts=False):
    if write:
        owner_id = db.query(DebtSpace.owner_id).filter_by(id=ident).scalar()
        if owner_id is None:
            raise HTTPException(404, 'This debt space is unavailable.')
        lock_owners(db, owner_id, user.id)
    rows = accessible_spaces(db, user).filter(DebtSpace.id == ident).populate_existing()
    row = rows.first()
    if not row:
        raise HTTPException(404, 'This debt space is unavailable.')
    if row.owner_id == user.id:
        return row, 'owner'
    grant = db.query(DebtSpaceMember).filter(DebtSpaceMember.space_id == ident, member_match(user))
    member = grant.order_by(DebtSpaceMember.member_user_id.desc().nullslast()).first()
    if not member or owner_only or (write and not changing_alerts and member.role != 'edit'):
        raise HTTPException(403, 'You do not have permission to change this debt space.')
    return row, member.role


def summary(row, role, owner_name, member_count):
    return {'id': row.id, 'name': row.name, 'role': role, 'owner_name': owner_name,
            'member_count': member_count, 'currency': json.loads(row.value)['currency']}


def access_details(db, row, role):
    owner = db.get(User, row.owner_id)
    members = db.query(DebtSpaceMember).filter_by(space_id=row.id).order_by(DebtSpaceMember.email).all()
    return {**summary(row, role, owner.username, len(members) + 1), 'members': [{'email': owner.email, 'name': owner.username, 'role': 'owner'}] + [
        {'email': member.email, 'role': member.role} for member in members]}


@router.get('/spaces')
def list_spaces(user: User = Depends(current_user), db: Session = Depends(get_db)):
    # Bind pending invitations to the first signed-in account with this address.
    pending = db.query(DebtSpaceMember).filter_by(email=user.email.lower(), member_user_id=None)
    owners = db.query(DebtSpace.owner_id).filter(DebtSpace.id.in_(pending.with_entities(DebtSpaceMember.space_id))).all()
    if owners:
        lock_owners(db, user.id, *(owner_id for owner_id, in owners))
        claimed = {ident for ident, in db.query(DebtSpaceMember.space_id).filter_by(member_user_id=user.id)}
        for member in pending.populate_existing():
            if member.space_id in claimed:
                db.delete(member)
            else:
                member.member_user_id = user.id
        db.commit()
    roles = dict(db.query(DebtSpaceMember.space_id, DebtSpaceMember.role).filter(member_match(user))
                 .order_by(DebtSpaceMember.member_user_id.asc().nullsfirst()).all())
    member_count = db.query(func.count()).filter(DebtSpaceMember.space_id == DebtSpace.id).correlate(DebtSpace).scalar_subquery()
    rows = db.query(DebtSpace, User.username, member_count).join(User, User.id == DebtSpace.owner_id).filter(
        or_(DebtSpace.owner_id == user.id, DebtSpace.id.in_(roles)))
    return [summary(row, 'owner' if row.owner_id == user.id else roles[row.id], name, count + 1)
            for row, name, count in rows.order_by(DebtSpace.name, DebtSpace.id)]


@router.post('/spaces', status_code=201)
def create_shared_space(payload: SharedSpaceIn, request: Request, user: User = Depends(current_user),
                        db: Session = Depends(get_db)):
    if payload.currency not in CURRENCY_CODES:
        raise HTTPException(422, 'Choose a supported currency.')
    lock_owners(db, user.id)
    receipt, previous = reserve(db, user.id, 'debt-space', request.headers.get('Idempotency-Key'), payload)
    if previous is not None:
        return previous
    if db.query(DebtSpace).filter_by(owner_id=user.id).count() >= 50:
        raise HTTPException(422, 'You can own up to 50 shared debt spaces.')
    row = DebtSpace(id=str(uuid4()), owner_id=user.id, name=payload.name, value=Workspace(currency=payload.currency).model_dump_json())
    db.add(row)
    result = summary(row, 'owner', user.username, 1)
    if receipt:
        receipt.response = json.dumps(result)
    db.commit()
    return result


@router.get('/spaces/{space_id}')
def read_shared_space(space_id: UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row, _ = shared_access(db, str(space_id), user)
    return Workspace.model_validate_json(row.value)


@router.put('/spaces/{space_id}')
def save_shared_space(space_id: UUID, payload: Workspace, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row, _ = shared_access(db, str(space_id), user, write=True)
    current = Workspace.model_validate_json(row.value)
    if payload.currency != current.currency:
        raise HTTPException(422, 'The debt space currency is already set.')
    return store_workspace(db, row, current, payload, user, shared=True)


@router.patch('/spaces/{space_id}')
def rename_shared_space(space_id: UUID, payload: DebtSpaceName, user: User = Depends(current_user),
                        db: Session = Depends(get_db)):
    row, role = shared_access(db, str(space_id), user, write=True, owner_only=True)
    row.name = payload.name
    result = access_details(db, row, role)
    db.commit()
    return result


@router.delete('/spaces/{space_id}', status_code=204)
def delete_shared_space(space_id: UUID, payload: DebtSpaceDelete, user: User = Depends(current_user),
                        db: Session = Depends(get_db)):
    row, _ = shared_access(db, str(space_id), user, write=True, owner_only=True)
    if payload.confirmation_name != row.name:
        raise HTTPException(409, 'The space name did not match. Check the current name before deleting.')
    # The database cascades to only this space's access grants and reminder preferences.
    db.delete(row)
    db.commit()
    return Response(status_code=204)


@router.get('/spaces/{space_id}/access')
def read_access(space_id: UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row, role = shared_access(db, str(space_id), user)
    return access_details(db, row, role)


@router.put('/spaces/{space_id}/members')
def set_debt_member(space_id: UUID, payload: MemberIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row, role = shared_access(db, str(space_id), user, write=True, owner_only=True)
    if payload.email == user.email.lower():
        raise HTTPException(422, 'The owner already has full access.')
    account = db.query(User).filter_by(email=payload.email).first()
    member = db.get(DebtSpaceMember, (row.id, payload.email))
    if account and (not member or member.member_user_id is None):
        claimed = db.query(DebtSpaceMember).filter_by(space_id=row.id, member_user_id=account.id).first()
        if claimed:
            if member:
                db.delete(member)
            member = claimed
    if member:
        member.role = payload.role
        if member.member_user_id is None and account:
            member.member_user_id = account.id
    else:
        if db.query(DebtSpaceMember).filter_by(space_id=row.id).count() >= 50:
            raise HTTPException(422, 'A debt space can have up to 50 invited members.')
        db.add(DebtSpaceMember(space_id=row.id, email=payload.email, role=payload.role, member_user_id=account.id if account else None))
    db.flush()
    result = access_details(db, row, role)
    db.commit()
    return result


@router.delete('/spaces/{space_id}/members/{email}')
def remove_debt_member(space_id: UUID, email: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row, role = shared_access(db, str(space_id), user, write=True, owner_only=True)
    member = db.get(DebtSpaceMember, (row.id, email.lower()))
    if member:
        if member.member_user_id is not None:
            db.query(DebtSpaceAlert).filter_by(space_id=row.id, user_id=member.member_user_id).delete(synchronize_session=False)
            account = db.get(User, member.member_user_id)
            if account:
                db.query(DebtSpaceMember).filter_by(space_id=row.id, email=account.email.lower(), member_user_id=None).delete(synchronize_session=False)
        db.delete(member)
        db.flush()
    result = access_details(db, row, role)
    db.commit()
    return result


def debt_alerts(db, ident, user_id):
    store = db.get(DebtSpaceAlert, (ident, user_id), populate_existing=True)
    return store, DebtAlerts.model_validate_json(store.value) if store else DebtAlerts()


@router.get('/spaces/{space_id}/alerts')
def read_alerts(space_id: UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row, _ = shared_access(db, str(space_id), user)
    return debt_alerts(db, row.id, user.id)[1]


@router.put('/spaces/{space_id}/alerts')
def save_alerts(space_id: UUID, payload: DebtAlerts, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row, _ = shared_access(db, str(space_id), user, write=True, changing_alerts=True)
    store, _ = debt_alerts(db, row.id, user.id)
    valid_ids = {record.id for record in Workspace.model_validate_json(row.value).records}
    payload.rules = {ident: lead for ident, lead in payload.rules.items() if ident in valid_ids}
    if store:
        store.value = payload.model_dump_json()
    else:
        db.add(DebtSpaceAlert(space_id=row.id, user_id=user.id, value=payload.model_dump_json()))
    db.commit()
    return payload


def outstanding(item):
    return item.amount - sum(payment.amount for payment in item.payments)


def add_payment(db, row, current, payload, user, *, shared=False):
    payment = payload.payment
    record = next((record for record in current.records if record.id == payload.record_id), None)
    term = next((term for term in record.items if term.id == payload.item_id), None) if record else None
    if not term:
        raise HTTPException(404, 'This payment month is no longer available.')
    current_payment = next((saved for saved in term.payments if saved.id == payment.id), None)
    if current_payment:
        if current_payment != payment:
            raise HTTPException(409, 'This payment was already saved with different details.')
        return current
    if current.revision != payload.revision:
        raise HTTPException(409, 'Debts changed on another device. Refresh and try again.')
    if not date(1900, 1, 1) <= payment.date <= today():
        raise HTTPException(422, 'Choose the date the money moved.')
    available = outstanding(term)
    if available <= 0:
        raise HTTPException(422, 'Choose a month that still has a payment due.')
    if len(term.payments) >= 60:
        raise HTTPException(422, 'This month has reached the limit of 60 recorded payments.')
    unit = 10 ** (3 - min(currency_digits(current.currency or 'KWD'), 3))
    if payment.amount % unit:
        raise HTTPException(422, 'Check the number of decimal places for this currency.')
    extra = payment.amount - available
    updated = current.model_copy(deep=True)
    updated_record = next(record for record in updated.records if record.id == payload.record_id)
    selected = next(item for item in updated_record.items if item.id == payload.item_id)
    if extra > 0:
        future = sorted((item for item in updated_record.items if item.month > selected.month and outstanding(item) > 0),
                        key=lambda item: item.month)
        future_balance = sum(outstanding(item) for item in future)
        if extra > future_balance:
            raise HTTPException(422, 'This payment exceeds the balance for this month and later.')
        if (future_balance - extra) % unit:
            raise HTTPException(422, 'The remaining balance does not match this currency’s precision.')
        share, remainder = divmod((future_balance - extra) // unit, len(future))
        for index, item in enumerate(future):
            new_balance = (share + (index < remainder)) * unit
            item.amount = item.amount - outstanding(item) + new_balance
            if not new_balance:
                item.covered_by = selected.month
        selected.amount += extra
    selected.payments.append(payment)
    try:
        updated = Workspace.model_validate(updated.model_dump())
    except ValueError:
        raise HTTPException(422, 'The payment would exceed the supported schedule limits.') from None
    return store_workspace(db, row, current, updated, user, shared=shared)


@router.post('/payments')
def pay_private_debt(payload: NewPayment, user: User = Depends(current_user), db: Session = Depends(get_db)):
    lock_owners(db, user.id)
    row, current = load_workspace(db, user.id)
    return add_payment(db, row, current, payload, user)


@router.post('/spaces/{space_id}/payments')
def pay_shared_debt(space_id: UUID, payload: NewPayment, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row, _ = shared_access(db, str(space_id), user, write=True)
    return add_payment(db, row, Workspace.model_validate_json(row.value), payload, user, shared=True)


@router.get('/reminders')
def due_alerts(user: User = Depends(current_user), db: Session = Depends(get_db)):
    def alarms(workspace, ident=None, prefs=None):
        if not (prefs.enabled if prefs else workspace.enabled):
            return
        for record in workspace.records:
            lead = prefs.rules.get(record.id) if prefs else record.reminder
            if lead is None:
                continue
            for item in record.items:
                if outstanding(item):
                    yield {'space_id': ident, 'item_id': item.id, 'name': record.name,
                           'due': item.due, 'day': item.due - timedelta(days=lead)}
    current = today()
    entries = list(alarms(load_workspace(db, user.id)[1]))
    for row in accessible_spaces(db, user):
        prefs = debt_alerts(db, row.id, user.id)[1]
        if prefs.rules:
            entries.extend(alarms(Workspace.model_validate_json(row.value), row.id, prefs))
    return sorted((entry for entry in entries if entry['day'] >= current), key=lambda row: row['day'])[:80]
