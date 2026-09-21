"""Opening balances are ledger entries, never a second source of money."""
from decimal import Decimal

from fastapi import HTTPException

from .models import Transaction, Wallet, WalletShare
from .timekeeping import now


def personal_wallet_ids(db, user_id):
    shared = db.query(WalletShare.wallet_id).filter(WalletShare.owner_id == user_id)
    return db.query(Wallet.id).filter(Wallet.user_id == user_id, ~Wallet.id.in_(shared))


def personal_records(db, user_id):
    ids = personal_wallet_ids(db, user_id)
    return db.query(Transaction).filter(
        Transaction.user_id == user_id, Transaction.wallet_id.in_(ids),
        (Transaction.transfer_wallet_id.is_(None) | Transaction.transfer_wallet_id.in_(ids)),
    )


def opening_amount(db, wallet):
    rows = db.query(Transaction).filter_by(wallet_id=wallet.id, is_opening_balance=True).all()
    return wallet.initial_balance + sum((row.amount if row.type == 'income' else -row.amount for row in rows), Decimal('0'))


def set_opening_balance(db, wallet, amount, actor_id=None):
    amount = Decimal(str(amount)).quantize(Decimal('0.001'))
    entries = db.query(Transaction).filter_by(wallet_id=wallet.id, is_opening_balance=True).order_by(Transaction.id).all()
    entry = entries[0] if entries else None
    for duplicate in entries[1:]:
        db.delete(duplicate)
    wallet.initial_balance = Decimal('0')
    if not amount:
        if entry:
            db.delete(entry)
    elif entry:
        entry.amount = abs(amount)
        entry.type = 'income' if amount > 0 else 'expense'
    else:
        db.add(Transaction(user_id=wallet.user_id, wallet_id=wallet.id,
                           type='income' if amount > 0 else 'expense', amount=abs(amount),
                           description='Opening balance', notes='', date=wallet.created_at or now(),
                           is_opening_balance=True, recorded_by_id=actor_id,
                           recurring_frequency='none'))
    db.flush()


def migrate_opening_balances(db, user_id=None):
    # Clearing the legacy field in the same transaction makes retries idempotent.
    query = db.query(Wallet).filter(Wallet.initial_balance != 0)
    if user_id is not None:
        query = query.filter(Wallet.user_id == user_id)
    for wallet in query.with_for_update().all():
        set_opening_balance(db, wallet, opening_amount(db, wallet))


def require_regular_transaction(row):
    if row.is_opening_balance:
        raise HTTPException(409, 'Edit the opening balance in Wallets to keep this wallet consistent.')
