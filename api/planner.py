"""Read-only cash-flow projections; saved plans never create ledger entries."""
import calendar
import hashlib
import json
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from .database import get_db
from .index import current_user
from .ledger_accounting import personal_wallet_ids
from .models import AppSetting, PlannedTransaction, Transaction, User, Wallet
from .timekeeping import ledger_iso, ledger_time, now

router = APIRouter(prefix='/api/planner', tags=['Planner'])
KEY = 'cash_flow_planner_v1'
Money = Field(default=Decimal(0), ge=0, le=999999999, max_digits=12, decimal_places=3)


class Bill(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: UUID
    name: str = Field(min_length=1, max_length=100)
    amount: Decimal = Field(gt=0, le=999999999, max_digits=12, decimal_places=3)
    wallet_id: int = Field(ge=0)
    due_at: datetime
    frequency: Literal['none', 'weekly', 'monthly', 'yearly'] = 'monthly'
    kind: Literal['bill', 'subscription'] = 'bill'
    active: bool = True
    reminder_enabled: bool = True
    planned_id: int | None = Field(default=None, gt=0)

    @field_validator('name')
    @classmethod
    def name_not_blank(cls, value):
        if not value.strip():
            raise ValueError('Enter a bill name')
        return value.strip()

    @field_validator('due_at')
    @classmethod
    def valid_date(cls, value):
        value = ledger_time(value)
        if not 2000 <= value.year <= 2100:
            raise ValueError('Choose a date between 2000 and 2100')
        return value.replace(second=0, microsecond=0)


class Config(BaseModel):
    model_config = ConfigDict(extra='forbid')
    revision: int = Field(default=0, ge=0)
    goal_reserve: Decimal = Money
    buffer: Decimal = Money
    bills: list[Bill] = Field(default_factory=list, max_length=100)

    @model_validator(mode='after')
    def unique_ids(self):
        if len({b.id for b in self.bills}) != len(self.bills):
            raise ValueError('Bill IDs must be unique')
        links = [b.planned_id for b in self.bills if b.planned_id]
        if len(set(links)) != len(links):
            raise ValueError('An Upcoming entry can only be linked once')
        return self


class Scenario(BaseModel):
    model_config = ConfigDict(extra='forbid')
    amount: Decimal = Field(gt=0, le=999999999, max_digits=12, decimal_places=3)
    date: date
    description: str = Field(default='What-if purchase', min_length=1, max_length=100)


class Payment(BaseModel):
    revision: int = Field(ge=0)
    occurrence: datetime
    transaction_id: int = Field(gt=0)


class SavedPayment(BaseModel):
    occurrence: datetime
    transaction_id: int = Field(gt=0)
    amount: Decimal | None = Field(default=None, gt=0, le=999999999, decimal_places=3)
    transaction_created_at: datetime | None = None


class Price(BaseModel):
    amount: Decimal = Field(gt=0, le=999999999, max_digits=12, decimal_places=3)
    changed_at: datetime


def validate_archive(value, wallet_ids=None, tx_ids=None, plan_ids=None):
    saved = json.loads(value) if isinstance(value, str) else value
    if not isinstance(saved, dict) or not isinstance(saved.get('bills'), list):
        raise ValueError('Invalid Planner archive')
    clean = Config.model_validate({**saved, 'bills': [{k: v for k, v in b.items() if k not in {'price_history', 'payments'}} for b in saved['bills']]}).model_dump(mode='json')
    used = set()
    for raw, bill in zip(saved['bills'], clean['bills']):
        history, payments = raw.get('price_history', []), raw.get('payments', [])
        if not isinstance(history, list) or len(history) > 12 or not isinstance(payments, list) or len(payments) > 1000:
            raise ValueError('Invalid bill history')
        bill['price_history'] = [Price.model_validate(p).model_dump(mode='json') for p in history]
        bill['payments'] = []
        for p in payments:
            payment = SavedPayment.model_validate(p)
            if payment.transaction_id in used or (tx_ids is not None and payment.transaction_id not in tx_ids):
                raise ValueError('Invalid bill payment reference')
            used.add(payment.transaction_id)
            if len(used) > 10000:
                raise ValueError('Too many payment links')
            bill['payments'].append({'occurrence': ledger_time(payment.occurrence).isoformat(), 'transaction_id': payment.transaction_id, 'amount': cash(payment.amount) if payment.amount is not None else bill['amount'], 'transaction_created_at': payment.transaction_created_at.isoformat() if payment.transaction_created_at else None})
        if wallet_ids is not None and bill['wallet_id'] not in wallet_ids and not (bill['wallet_id'] == 0 and not bill['active']):
            raise ValueError('Invalid bill wallet')
        if bill['planned_id'] and plan_ids is not None and bill['planned_id'] not in plan_ids:
            raise ValueError('Invalid linked plan')
    return clean


def archive_snapshot(saved, wallet_ids, tx_ids, plan_ids, payment_records=None, user_id=None):
    """Prune deleted links, but preserve a deleted wallet's bill as a paused draft."""
    saved = validate_archive(saved)
    for bill in saved['bills']:
        if bill['wallet_id'] not in wallet_ids:
            bill['wallet_id'], bill['active'] = 0, False
        if bill['planned_id'] not in plan_ids:
            bill['planned_id'] = None
        bill['payments'] = [p for p in bill['payments'] if p['transaction_id'] in tx_ids
                            and (payment_records is None or valid_payment(payment_records.get(p['transaction_id']), p, bill, user_id, now()))]
    return saved


def load_config(db, user_id):
    row = db.get(AppSetting, {'user_id': user_id, 'key': KEY}, populate_existing=True)
    if not row:
        return {'revision': 0, 'goal_reserve': '0.000', 'buffer': '0.000', 'bills': []}
    try:
        return validate_archive(row.value)
    except (ValueError, KeyError, TypeError):
        raise HTTPException(409, 'Planner settings need recovery. Restore a valid backup; existing transactions are unchanged.')


def lock_config(db, user_id, revision):
    # A user row exists even before the first Planner save, so concurrent first saves serialize too.
    db.query(User).filter_by(id=user_id).with_for_update().first()
    saved = load_config(db, user_id)
    if saved['revision'] != revision:
        raise HTTPException(409, 'Planner changed on another device. Reload before saving; your changes have not been applied.')
    return saved


def persist(db, user_id, saved):
    saved['revision'] += 1
    row = db.get(AppSetting, {'user_id': user_id, 'key': KEY})
    value = json.dumps(saved, separators=(',', ':'))
    if row:
        row.value = value
    else:
        db.add(AppSetting(user_id=user_id, key=KEY, value=value))
    db.commit()
    return saved


def owned_wallets(db, user_id):
    return db.query(Wallet).filter(Wallet.id.in_(personal_wallet_ids(db, user_id)), Wallet.archived.is_(False)).order_by(Wallet.id).all()


@router.get('/config')
def get_config(user=Depends(current_user), db: Session = Depends(get_db)):
    return load_config(db, user.id)


@router.put('/config')
def save_config(payload: Config, user=Depends(current_user), db: Session = Depends(get_db)):
    old = lock_config(db, user.id, payload.revision)
    previous = {b['id']: b for b in old['bills']}
    wallet_ids = {w.id for w in owned_wallets(db, user.id)}
    saved = payload.model_dump(mode='json')
    for bill in saved['bills']:
        before = previous.get(bill['id'], {})
        if bill['active'] and bill['wallet_id'] not in wallet_ids:
            raise HTTPException(422, 'Choose an active personal wallet, or pause the unavailable bill.')
        if bill['planned_id']:
            plan = db.get(PlannedTransaction, bill['planned_id'])
            if not plan or plan.owner_id != user.id or plan.wallet_id != bill['wallet_id'] or plan.type != 'expense' or ledger_time(plan.due_at) != ledger_time(datetime.fromisoformat(bill['due_at'])) or plan.amount != Decimal(bill['amount']):
                raise HTTPException(422, 'Link an Upcoming expense with the same wallet, amount, and due time.')
        bill['price_history'] = before.get('price_history', [])
        if before and Decimal(before['amount']) != Decimal(bill['amount']):
            bill['price_history'] = ([{'amount': before['amount'], 'changed_at': ledger_iso(now())}] + bill['price_history'])[:12]
        same_schedule = all(before.get(k) == bill[k] for k in ('due_at', 'frequency', 'wallet_id'))
        bill['payments'] = before.get('payments', []) if same_schedule else []
    return persist(db, user.id, saved)


def occurrences(anchor, frequency, end):
    """Keep the original day through short months and leap years."""
    step = 0
    while True:
        if frequency == 'weekly':
            value = anchor + timedelta(weeks=step)
        elif frequency in {'monthly', 'yearly'}:
            months = anchor.year * 12 + anchor.month - 1 + step * (12 if frequency == 'yearly' else 1)
            year, month = divmod(months, 12)
            month += 1
            value = anchor.replace(year=year, month=month, day=min(anchor.day, calendar.monthrange(year, month)[1]))
        else:
            value = anchor
        if value > end:
            return
        yield value
        if frequency == 'none':
            return
        step += 1
        if step > 6000:
            raise HTTPException(422, 'This bill has too many unpaid cycles. Update its next due date in Bills.')


def cash(value):
    return str(Decimal(value).quantize(Decimal('.001')))


def delta(tx, ids):
    if tx.type == 'transfer':
        return (tx.amount if getattr(tx, 'transfer_wallet_id', None) in ids else Decimal(0)) - (tx.amount if tx.wallet_id in ids else Decimal(0))
    if tx.wallet_id not in ids:
        return Decimal(0)
    return tx.amount if tx.type == 'income' else -tx.amount


def valid_payment(record, payment, bill, user_id, at):
    # Local SQLite databases can reuse a deleted row ID; keep the original row identity too.
    return bool(record and record.user_id == user_id and record.type == 'expense'
                and not record.is_opening_balance and record.wallet_id == bill['wallet_id']
                and record.date <= at and record.amount == Decimal(payment.get('amount') or bill['amount'])
                and payment.get('transaction_created_at') == record.created_at.isoformat())


def forecast(db, user_id, days=30, include_assumptions=True, scenario=None, at=None):
    if days not in {30, 60, 90}:
        raise HTTPException(422, 'Choose a 30, 60, or 90-day forecast')
    at = ledger_time(at or now())
    end = datetime.combine(at.date() + timedelta(days=days), datetime.max.time())
    config = load_config(db, user_id)
    wallets = owned_wallets(db, user_id)
    ids = {w.id for w in wallets}
    wallet_names = {w.id: w.name for w in wallets}
    # Aggregate history rather than loading a user's entire ledger into memory.
    totals = db.query(Transaction.type, func.sum(Transaction.amount)).filter(Transaction.wallet_id.in_(ids), Transaction.date <= at).group_by(Transaction.type).all()
    sums = dict(totals)
    incoming = db.query(func.sum(Transaction.amount)).filter(Transaction.type == 'transfer', Transaction.transfer_wallet_id.in_(ids), Transaction.date <= at).scalar() or Decimal(0)
    opening = sum((w.initial_balance for w in wallets), Decimal(0)) + Decimal(sums.get('income') or 0) - Decimal(sums.get('expense') or 0) - Decimal(sums.get('transfer') or 0) + incoming
    future = db.query(Transaction).filter(or_(Transaction.wallet_id.in_(ids), Transaction.transfer_wallet_id.in_(ids)), Transaction.date > at, Transaction.date <= end).all()
    events, warnings = [], []

    def add(key, due, amount, name, certainty, source, wallet_id, kind):
        if not amount:
            return
        if len(events) >= 10000:
            raise HTTPException(422, 'Too many unpaid bill cycles. Update the next due dates before forecasting.')
        events.append({'id': key, 'date': ledger_iso(max(at, due)), 'due_at': ledger_iso(due), 'amount': cash(amount), 'name': name,
                       'certainty': certainty, 'source': source, 'wallet_name': wallet_names.get(wallet_id, ''), 'wallet_id': wallet_id,
                       'type': kind, 'overdue': due < at})

    for tx in future:
        add(f'tx:{tx.id}', tx.date, delta(tx, ids), tx.description, 'Recorded', '/transactions', tx.wallet_id, tx.type)
    plans = db.query(PlannedTransaction).filter(PlannedTransaction.owner_id == user_id, PlannedTransaction.wallet_id.in_(ids), PlannedTransaction.due_at <= end).all()
    for plan in plans:
        if plan.status not in {'planned', 'scheduled'} or (plan.status == 'planned' and not include_assumptions):
            continue
        amount = delta(plan, ids)
        add(f'plan:{plan.id}', plan.due_at, amount, plan.description, 'Expected' if plan.status == 'scheduled' else 'Assumed', '/upcoming', plan.wallet_id, plan.type)
    linked = {p.id: p for p in plans}
    templates = db.query(Transaction).filter(Transaction.user_id == user_id, Transaction.wallet_id.in_(ids), Transaction.recurring_parent_id.is_(None), Transaction.recurring_frequency != 'none', Transaction.date <= end).all() if include_assumptions else []
    children = {(p, d) for p, d in db.query(Transaction.recurring_parent_id, Transaction.date).filter(Transaction.recurring_parent_id.in_([t.id for t in templates]), Transaction.date <= end).all()}
    # Match the existing recurring ledger's dates, including its month-end behavior.
    from .index import next_occurrence
    for tx in templates:
        due = next_occurrence(tx.date, tx.recurring_frequency)
        count = 0
        while due <= end and (not tx.recurring_until or due.date() <= tx.recurring_until):
            if (tx.id, due) not in children:
                add(f'repeat:{tx.id}:{due.isoformat()}', due, delta(tx, ids), tx.description, 'Assumed', '/transactions', tx.wallet_id, tx.type)
            following = next_occurrence(due, tx.recurring_frequency)
            if following <= due:
                break
            due = following
            count += 1
            if count > 40000:
                raise HTTPException(422, 'A recurring record is too old to forecast. Update its recurrence.')
    reminders = []
    all_payment_ids = [p['transaction_id'] for b in config['bills'] for p in b.get('payments', [])]
    payment_records = {t.id: t for t in db.query(Transaction).filter(Transaction.id.in_(all_payment_ids), Transaction.user_id == user_id, Transaction.type == 'expense', Transaction.is_opening_balance.is_(False), Transaction.date <= at).all()}
    for bill in config['bills']:
        if not bill['active']:
            continue
        if bill['wallet_id'] not in ids:
            warnings.append(f"{bill['name']}: wallet unavailable or shared; excluded from this personal forecast.")
            continue
        anchor = ledger_time(datetime.fromisoformat(bill['due_at']))
        paid = {p['occurrence']: p['transaction_id'] for p in bill.get('payments', [])}
        paid_transactions = {p['transaction_id'] for p in bill.get('payments', []) if valid_payment(payment_records.get(p['transaction_id']), p, bill, user_id, at)}
        for due in occurrences(anchor, bill['frequency'], end):
            if paid.get(due.isoformat()) in paid_transactions:
                continue
            plan = linked.get(bill.get('planned_id'))
            if due == anchor and plan and plan.type == 'expense' and plan.amount == Decimal(bill['amount']) and plan.due_at == due:
                if plan.status in {'planned', 'scheduled'} or (plan.status == 'posted' and db.get(Transaction, plan.posted_transaction_id)):
                    continue
            identifier = f"bill:{bill['id']}:{due.isoformat()}"
            if include_assumptions:
                add(identifier, due, -Decimal(bill['amount']), bill['name'], 'Assumed', '/planner', bill['wallet_id'], 'expense')
            if bill['reminder_enabled'] and due >= at - timedelta(days=1):
                notification_id = 400000000 + int.from_bytes(hashlib.sha256(identifier.encode()).digest()[:4], 'big') % 500000000
                reminders.append({'id': identifier, 'notification_id': notification_id, 'date': ledger_iso(due), 'description': bill['name'], 'wallet_name': wallet_names[bill['wallet_id']], 'status': 'planned', 'type': 'expense', 'reminder_enabled': True})
    if scenario:
        if not at.date() <= scenario.date <= end.date():
            raise HTTPException(422, 'Choose a what-if date inside the selected forecast.')
        add('scenario', datetime.combine(scenario.date, at.time()), -scenario.amount, scenario.description, 'What if', '/planner', None, 'expense')
    events.sort(key=lambda e: (e['date'], Decimal(e['amount']) >= 0, e['id']))
    reserve = Decimal(config['goal_reserve']) + Decimal(config['buffer'])
    balance, lowest, low_date, first_shortfall = opening, opening, at.date(), at.date() if opening < reserve else None
    points = [{'date': at.date().isoformat(), 'balance': cash(opening)}]
    index = 0
    for offset in range(days + 1):
        day = at.date() + timedelta(days=offset)
        while index < len(events) and events[index]['date'][:10] == day.isoformat():
            event = events[index]
            balance += Decimal(event['amount'])
            event['balance_after'] = cash(balance)
            if balance < lowest:
                lowest, low_date = balance, day
            if first_shortfall is None and balance < reserve:
                first_shortfall = day
            index += 1
        if offset == 0:
            points[0]['balance'] = cash(balance)
        else:
            points.append({'date': day.isoformat(), 'balance': cash(balance)})
    payday = next((e['date'] for e in events if e['type'] == 'income' and Decimal(e['amount']) > 0 and e['certainty'] != 'What if'), None)
    bills_before_payday = -sum((Decimal(e['amount']) for e in events if Decimal(e['amount']) < 0 and (not payday or e['date'] <= payday)), Decimal(0))
    available = opening - reserve - bills_before_payday
    if any(e['overdue'] for e in events):
        warnings.append('Unpaid past-due items are included today. Link a recorded payment or update their due dates.')
    result = {'as_of': ledger_iso(at), 'days': days, 'opening_balance': cash(opening), 'projected_balance': cash(balance),
              'lowest_balance': cash(lowest), 'lowest_date': low_date.isoformat(), 'shortfall_date': first_shortfall.isoformat() if first_shortfall else None,
              'shortfall_amount': cash(max(Decimal(0), reserve - lowest)), 'available_to_spend': cash(available), 'reserved': cash(reserve),
              'goal_reserve': config['goal_reserve'], 'buffer': config['buffer'], 'bills_before_payday': cash(bills_before_payday), 'next_payday': payday,
              'include_assumptions': include_assumptions, 'points': points, 'events': events, 'warnings': warnings,
              'wallets': [{'id': w.id, 'name': w.name} for w in wallets], 'reminders': reminders,
              'basis': 'Personal wallets only. Cash dates, not reporting months. Future income is not available cash. Estimates do not change records.'}
    return result


@router.get('/forecast')
def get_forecast(days: int = Query(30, ge=30, le=90), assumptions: bool = True, user=Depends(current_user), db: Session = Depends(get_db)):
    return forecast(db, user.id, days, assumptions)


@router.get('/summary')
def summary(user=Depends(current_user), db: Session = Depends(get_db)):
    result = forecast(db, user.id)
    return {k: v for k, v in result.items() if k not in {'events', 'points', 'reminders', 'wallets'}}


@router.get('/reminders')
def reminders(user=Depends(current_user), db: Session = Depends(get_db)):
    return {'items': forecast(db, user.id, 90)['reminders']}


@router.post('/preview')
def preview(payload: Scenario, days: int = Query(30, ge=30, le=90), assumptions: bool = True, user=Depends(current_user), db: Session = Depends(get_db)):
    return forecast(db, user.id, days, assumptions, payload)


@router.get('/payment-options')
def payment_options(wallet_id: int = Query(gt=0), user=Depends(current_user), db: Session = Depends(get_db)):
    if wallet_id not in {w.id for w in owned_wallets(db, user.id)}:
        raise HTTPException(403, 'Choose a personal wallet')
    rows = db.query(Transaction).filter(Transaction.user_id == user.id, Transaction.wallet_id == wallet_id, Transaction.type == 'expense', Transaction.is_opening_balance.is_(False), Transaction.date <= now(), Transaction.date >= now() - timedelta(days=180)).order_by(Transaction.date.desc()).limit(100).all()
    return [{'id': t.id, 'description': t.description, 'date': ledger_iso(t.date), 'amount': cash(t.amount)} for t in rows]


@router.get('/link-options')
def link_options(user=Depends(current_user), db: Session = Depends(get_db)):
    ids = [w.id for w in owned_wallets(db, user.id)]
    rows = db.query(PlannedTransaction).filter(PlannedTransaction.owner_id == user.id, PlannedTransaction.wallet_id.in_(ids), PlannedTransaction.type == 'expense', PlannedTransaction.status.in_(['planned', 'scheduled']), PlannedTransaction.due_at >= now() - timedelta(days=365)).order_by(PlannedTransaction.due_at).limit(1000).all()
    return [{'id': p.id, 'wallet_id': p.wallet_id, 'date': ledger_iso(p.due_at), 'description': p.description, 'amount': cash(p.amount)} for p in rows]


@router.post('/bills/{bill_id}/payment')
def link_payment(bill_id: UUID, payload: Payment, user=Depends(current_user), db: Session = Depends(get_db)):
    config = lock_config(db, user.id, payload.revision)
    bill = next((b for b in config['bills'] if b['id'] == str(bill_id)), None)
    if not bill:
        raise HTTPException(404, 'Bill not found')
    tx = db.get(Transaction, payload.transaction_id)
    if not tx or tx.user_id != user.id or tx.wallet_id != bill['wallet_id'] or tx.type != 'expense' or tx.is_opening_balance or tx.date > now() or tx.amount != Decimal(bill['amount']):
        raise HTTPException(422, 'Choose a recorded expense with the same wallet and amount.')
    if bill['wallet_id'] not in {w.id for w in owned_wallets(db, user.id)}:
        raise HTTPException(403, 'This bill no longer has a personal wallet')
    due = ledger_time(payload.occurrence).replace(second=0, microsecond=0)
    anchor = ledger_time(datetime.fromisoformat(bill['due_at']))
    if due > now() + timedelta(days=90) or due not in set(occurrences(anchor, bill['frequency'], due)):
        raise HTTPException(422, 'Choose a valid bill occurrence')
    existing = next((p for p in bill.get('payments', []) if p['occurrence'] == due.isoformat()), None)
    if existing:
        old = db.get(Transaction, existing['transaction_id'])
        if valid_payment(old, existing, bill, user.id, now()):
            raise HTTPException(409, 'This bill cycle already has a payment.')
        bill['payments'].remove(existing)
    payment_ids = [p['transaction_id'] for b in config['bills'] for p in b.get('payments', [])]
    records = {t.id: t for t in db.query(Transaction).filter(Transaction.id.in_(payment_ids), Transaction.user_id == user.id).all()}
    for saved_bill in config['bills']:
        saved_bill['payments'] = [p for p in saved_bill.get('payments', []) if valid_payment(records.get(p['transaction_id']), p, saved_bill, user.id, now())]
    used = {p['transaction_id'] for b in config['bills'] for p in b.get('payments', [])}
    if tx.id in used:
        raise HTTPException(409, 'This expense is already linked to a bill cycle.')
    payments = bill.setdefault('payments', [])
    if len(payments) >= 1000 or len(used) >= 10000:
        raise HTTPException(422, 'Advance the next due date to start a new bill schedule.')
    payments.append({'occurrence': due.isoformat(), 'transaction_id': tx.id, 'amount': cash(tx.amount), 'transaction_created_at': tx.created_at.isoformat()})
    return persist(db, user.id, config)
