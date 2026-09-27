"""Add independent upcoming and scheduled transaction records.

Revision ID: c514ac073e91
Revises: a27d84b75c40
"""
from alembic import op
import sqlalchemy as sa

revision = 'c514ac073e91'
down_revision = 'a27d84b75c40'
branch_labels = None
depends_on = None


def upgrade():
    if sa.inspect(op.get_bind()).has_table('planned_transactions'):
        return
    op.create_table('planned_transactions',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('owner_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('created_by_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('wallet_id', sa.Integer(), sa.ForeignKey('wallets.id'), nullable=False),
        sa.Column('transfer_wallet_id', sa.Integer(), sa.ForeignKey('wallets.id')),
        sa.Column('category_id', sa.Integer(), sa.ForeignKey('categories.id')),
        sa.Column('type', sa.String(20), nullable=False),
        sa.Column('amount', sa.Numeric(16, 3), nullable=False),
        sa.Column('description', sa.String(160), nullable=False),
        sa.Column('notes', sa.Text(), nullable=False),
        sa.Column('due_at', sa.DateTime(), nullable=False),
        sa.Column('status', sa.String(20), nullable=False),
        sa.Column('reminder_enabled', sa.Boolean(), nullable=False),
        sa.Column('posted_transaction_id', sa.Integer(), sa.ForeignKey('transactions.id'), unique=True),
        sa.Column('error', sa.String(240)),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.CheckConstraint('amount > 0', name='ck_planned_positive_amount'),
        sa.CheckConstraint("type IN ('income', 'expense', 'transfer')", name='ck_planned_type'),
        sa.CheckConstraint("status IN ('planned', 'scheduled', 'posted', 'failed')", name='ck_planned_status'))
    for name, columns in [('owner', ['owner_id']), ('wallet', ['wallet_id']), ('due', ['due_at']), ('status', ['status'])]:
        op.create_index(f'ix_planned_transactions_{name}', 'planned_transactions', columns)


def downgrade():
    op.drop_table('planned_transactions')
