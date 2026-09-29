"""Store optional wallet balance checks without changing transaction records.

Revision ID: f20c846d9a31
Revises: e84b3c9a712f
"""
from alembic import op
import sqlalchemy as sa


revision = 'f20c846d9a31'
down_revision = 'e84b3c9a712f'
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    if 'wallet_balance_checks' not in inspector.get_table_names():
        op.create_table(
            'wallet_balance_checks',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('wallet_id', sa.Integer(), sa.ForeignKey('wallets.id', ondelete='CASCADE'), nullable=False),
            sa.Column('checked_by_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
            sa.Column('checked_by_name', sa.String(80), nullable=False),
            sa.Column('expected_balance', sa.Numeric(16, 3), nullable=False),
            sa.Column('observed_balance', sa.Numeric(16, 3), nullable=False),
            sa.Column('currency', sa.String(8), nullable=False),
            sa.Column('note', sa.String(240), nullable=False),
            sa.Column('checked_at', sa.DateTime(), nullable=False),
        )
    indexes = {index['name'] for index in sa.inspect(op.get_bind()).get_indexes('wallet_balance_checks')}
    if 'ix_wallet_balance_checks_wallet_id' not in indexes:
        op.create_index('ix_wallet_balance_checks_wallet_id', 'wallet_balance_checks', ['wallet_id'])
    if 'ix_wallet_balance_checks_checked_at' not in indexes:
        op.create_index('ix_wallet_balance_checks_checked_at', 'wallet_balance_checks', ['checked_at'])


def downgrade():
    op.drop_index('ix_wallet_balance_checks_checked_at', table_name='wallet_balance_checks')
    op.drop_index('ix_wallet_balance_checks_wallet_id', table_name='wallet_balance_checks')
    op.drop_table('wallet_balance_checks')
