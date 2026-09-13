"""Scoped, bounded financial facts. The model never receives SQL or account secrets."""
import calendar
import json
from datetime import datetime
from decimal import Decimal
from fastapi import HTTPException
from sqlalchemy import func, or_
from sqlalchemy.orm import joinedload
from .models import Wallet, WalletShare, Transaction, Category, Budget, Goal, Debt
from .index import normalize_email, setting
from .timekeeping import now, ledger_iso


def access_wallet(db, user, wallet_id, edit=False, creating=False):
    wallet = db.get(Wallet, wallet_id)
    if not wallet:
        raise HTTPException(404, 'Wallet no longer available')
    permission = 'edit'
    if wallet.user_id != user.id:
        share = db.query(WalletShare).filter(WalletShare.wallet_id == wallet_id, or_(
            WalletShare.member_user_id == user.id, WalletShare.invitee_email == normalize_email(user.email))).first()
        if not share:
            raise HTTPException(403, 'You no longer have access to this shared wallet or its conversation')
        permission = share.permission
    if edit and permission != 'edit' and not (creating and permission == 'add'):
        raise HTTPException(403, 'This wallet does not allow that action')
    return wallet, permission


def scope_wallets(db, user, chat):
    if chat.scope == 'shared':
        return [access_wallet(db, user, chat.wallet_id)[0]]
    if chat.scope == 'general':
        return []
    rows = db.query(Wallet).filter_by(user_id=user.id)
    if chat.wallet_id:
        rows = rows.filter_by(id=chat.wallet_id)
        if not rows.first():
            raise HTTPException(403, 'This wallet is no longer available')
    return rows.order_by(Wallet.id).all()


def month_range(month):
    try:
        start = datetime.strptime(month, '%Y-%m')
        if start.strftime('%Y-%m') != month:
            raise ValueError()
        end = start.replace(year=start.year + 1, month=1) if start.month == 12 else start.replace(month=start.month + 1)
        return start, end
    except ValueError:
        raise HTTPException(422, 'Month must be YYYY-MM')


def cash(value):
    return str(Decimal(value or 0).quantize(Decimal('.001')))


def transaction_fact(tx, visible_ids):
    return {'reference': f'transaction:{tx.id}', 'id': tx.id, 'type': tx.type,
            'amount': cash(tx.amount), 'description': tx.description,
            'date': ledger_iso(tx.date),
            'wallet_id': tx.wallet_id if tx.wallet_id in visible_ids else None,
            'wallet': tx.wallet.name if tx.wallet_id in visible_ids else 'Private wallet',
            'transfer_wallet_id': tx.transfer_wallet_id if tx.transfer_wallet_id in visible_ids else None,
            'transfer_wallet': tx.transfer_wallet.name if tx.transfer_wallet_id in visible_ids else None,
            'category_id': tx.category_id, 'category': tx.category.name if tx.category else 'Uncategorized',
            'recurring_frequency': tx.recurring_frequency, 'recurring_until': str(tx.recurring_until) if tx.recurring_until else None}


def ledger_query(db, user, chat, ids):
    q = db.query(Transaction).filter(or_(Transaction.wallet_id.in_(ids), Transaction.transfer_wallet_id.in_(ids)))
    if chat.scope != 'shared':
        q = q.filter(Transaction.user_id == user.id)
    return q


def lookup(db, user, chat, month=None, search='', category_id=None):
    wallets = scope_wallets(db, user, chat)
    ids = {w.id for w in wallets}
    if not ids:
        return {'records': [], 'message': 'No financial data is attached in this context.'}, []
    start, end = month_range(month or chat.month)
    q = ledger_query(db, user, chat, ids).filter(Transaction.date >= start, Transaction.date < end)
    if search:
        q = q.filter(Transaction.description.ilike('%' + search[:100] + '%'))
    if category_id:
        q = q.filter(Transaction.category_id == category_id)
    count = q.count()
    totals = {kind: cash(total) for kind, total in q.with_entities(Transaction.type, func.sum(Transaction.amount)).group_by(Transaction.type).all()}
    grouped = q.outerjoin(Category, Transaction.category_id == Category.id).filter(Transaction.type == 'expense').with_entities(
        Category.name, func.sum(Transaction.amount)).group_by(Category.name).all()
    merchants = q.filter(Transaction.type == 'expense').with_entities(Transaction.description, func.count(Transaction.id), func.sum(Transaction.amount)).group_by(Transaction.description).order_by(func.sum(Transaction.amount).desc()).limit(12).all()
    rows = q.options(joinedload(Transaction.wallet), joinedload(Transaction.transfer_wallet), joinedload(Transaction.category)).order_by(Transaction.date.desc(), Transaction.id.desc()).limit(60).all()
    facts = [transaction_fact(tx, ids) for tx in rows]
    key = f'ledger:{start:%Y-%m}:{category_id or 0}:{search[:100]}'
    sources = [{'key': key, 'label': f'{start:%B %Y} ledger ({count} records)', 'path': '/shared-transactions' if chat.scope == 'shared' else '/transactions',
                'month': start.strftime('%Y-%m'), 'wallet_id': chat.wallet_id, 'category_id': category_id, 'search': search[:100]}]
    sources += [{'key': t['reference'], 'label': t['description'], 'kind': 'transaction', 'id': t['id'], 'path': sources[0]['path']} for t in facts]
    return {'reference': key, 'month': start.strftime('%Y-%m'), 'count': count,
            'totals': totals, 'expense_categories': [{'category': n or 'Uncategorized', 'amount': cash(v)} for n, v in grouped],
            'frequent_descriptions': [{'description': n, 'count': c, 'amount': cash(v)} for n, c, v in merchants],
            'records': facts, 'records_truncated': count > len(rows),
            'note': 'Totals cover ALL matching records; only the newest 60 individual records are attached. Transfers are not income or expenses.'}, sources


def build_context(db, user, chat):
    wallets = scope_wallets(db, user, chat)
    facts = {'as_of': ledger_iso(now()), 'currency': setting(db, user.id, 'currency', 'KWD'),
             'scope': chat.scope, 'month': chat.month}
    sources = []
    if chat.scope == 'general':
        return facts, sources
    ids = {w.id for w in wallets}
    totals = {(i, kind): Decimal(v or 0) for i, kind, v in db.query(Transaction.wallet_id, Transaction.type, func.sum(Transaction.amount)).filter(Transaction.wallet_id.in_(ids)).group_by(Transaction.wallet_id, Transaction.type).all()}
    incoming = dict(db.query(Transaction.transfer_wallet_id, func.sum(Transaction.amount)).filter(Transaction.type == 'transfer', Transaction.transfer_wallet_id.in_(ids)).group_by(Transaction.transfer_wallet_id).all())
    facts['wallets'] = [{'id': w.id, 'name': w.name, 'archived': w.archived,
        'balance': cash(Decimal(w.initial_balance) + totals.get((w.id, 'income'), 0) - totals.get((w.id, 'expense'), 0) - totals.get((w.id, 'transfer'), 0) + Decimal(incoming.get(w.id) or 0)),
        'permission': access_wallet(db, user, w.id)[1], 'reference': f'wallet:{w.id}'} for w in wallets]
    sources += [{'key': f'wallet:{w.id}', 'label': w.name, 'kind': 'wallet', 'id': w.id, 'path': '/shared-transactions' if chat.scope == 'shared' else '/wallets'} for w in wallets]
    category_owner = wallets[0].user_id if chat.scope == 'shared' and wallets else user.id
    facts['categories'] = [{'id': c.id, 'name': c.name, 'kind': c.kind} for c in db.query(Category).filter_by(user_id=category_owner).all()]
    facts['ledger'], ledger_sources = lookup(db, user, chat)
    sources += ledger_sources
    start, _ = month_range(chat.month)
    prev = start.replace(day=1) - __import__('datetime').timedelta(days=1)
    previous, prev_sources = lookup(db, user, chat, prev.strftime('%Y-%m'))
    facts['previous_month'] = {k: v for k, v in previous.items() if k not in {'records', 'frequent_descriptions'}}
    sources += prev_sources[:1]
    if chat.scope == 'personal':
        for kind, model, fields, path in [
            ('budgets', Budget, ('id', 'name', 'category_id', 'limit_amount', 'period', 'start_date'), '/budgets'),
            ('goals', Goal, ('id', 'name', 'target_amount', 'current_amount', 'deadline'), '/goals'),
            ('debts', Debt, ('id', 'name', 'principal', 'remaining', 'interest_rate', 'minimum_payment', 'due_date'), '/goals')]:
            rows = db.query(model).filter_by(user_id=user.id).order_by(model.id).limit(60).all()
            facts[kind] = [{**{k: str(getattr(row, k)) if getattr(row, k) is not None else None for k in fields}, 'reference': f'{kind[:-1]}:{row.id}'} for row in rows]
            sources += [{'key': f'{kind[:-1]}:{row.id}', 'label': row.name, 'kind': kind[:-1], 'id': row.id, 'path': path} for row in rows]
    return facts, sources
