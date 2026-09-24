"""Enforce valid new ledger and sharing records without rewriting existing rows.

Revision ID: a27d84b75c40
Revises: d321cbf4902b
"""
from alembic import op

revision = 'a27d84b75c40'
down_revision = 'd321cbf4902b'
branch_labels = None
depends_on = None


def upgrade():
    if op.get_bind().dialect.name != 'postgresql':
        return
    op.execute("ALTER TABLE transactions ADD CONSTRAINT ck_transactions_positive_amount CHECK (amount > 0) NOT VALID")
    op.execute("ALTER TABLE transactions ADD CONSTRAINT ck_transactions_type CHECK (type IN ('income', 'expense', 'transfer')) NOT VALID")
    op.execute("ALTER TABLE transactions ADD CONSTRAINT ck_transactions_transfer_wallet CHECK ((type = 'transfer' AND transfer_wallet_id IS NOT NULL AND transfer_wallet_id <> wallet_id) OR (type <> 'transfer' AND transfer_wallet_id IS NULL)) NOT VALID")
    op.execute("ALTER TABLE wallet_shares ADD CONSTRAINT ck_wallet_shares_permission CHECK (permission IN ('view', 'add', 'edit')) NOT VALID")


def downgrade():
    if op.get_bind().dialect.name != 'postgresql':
        return
    for table, name in [('wallet_shares', 'ck_wallet_shares_permission'),
                        ('transactions', 'ck_transactions_transfer_wallet'),
                        ('transactions', 'ck_transactions_type'),
                        ('transactions', 'ck_transactions_positive_amount')]:
        op.execute(f'ALTER TABLE {table} DROP CONSTRAINT {name}')
