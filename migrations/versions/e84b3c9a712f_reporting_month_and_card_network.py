"""Add reporting months and card network metadata.

Revision ID: e84b3c9a712f
Revises: c514ac073e91
"""
from datetime import datetime

from alembic import op
import sqlalchemy as sa


revision = 'e84b3c9a712f'
down_revision = 'c514ac073e91'
branch_labels = None
depends_on = None


def add_month_column(table, date_column):
    bind = op.get_bind()
    columns = {column['name']: column for column in sa.inspect(bind).get_columns(table)}
    if 'reporting_month' not in columns:
        op.add_column(table, sa.Column('reporting_month', sa.String(7), nullable=True))
    rows = bind.execute(sa.text(
        f'SELECT id, {date_column} FROM {table} WHERE reporting_month IS NULL'
    )).all()
    for row_id, value in rows:
        parsed = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        bind.execute(sa.text(
            f'UPDATE {table} SET reporting_month = :month WHERE id = :id'
        ), {'month': parsed.strftime('%Y-%m'), 'id': row_id})
    if bind.dialect.name != 'sqlite' and columns.get('reporting_month', {}).get('nullable', True):
        with op.batch_alter_table(table) as batch:
            batch.alter_column('reporting_month', existing_type=sa.String(7), nullable=False)


def upgrade():
    bind = op.get_bind()
    wallet_columns = {column['name'] for column in sa.inspect(bind).get_columns('wallets')}
    if 'card_network' not in wallet_columns:
        op.add_column('wallets', sa.Column('card_network', sa.String(12), nullable=True))
    add_month_column('transactions', 'date')
    add_month_column('planned_transactions', 'due_at')
    op.create_index('ix_transactions_user_reporting_month', 'transactions', ['user_id', 'reporting_month'], if_not_exists=True)
    op.create_index('ix_transactions_wallet_reporting_month', 'transactions', ['wallet_id', 'reporting_month'], if_not_exists=True)
    op.create_index('ix_planned_transactions_reporting_month', 'planned_transactions', ['owner_id', 'reporting_month'], if_not_exists=True)


def downgrade():
    for table, name in (
        ('planned_transactions', 'ix_planned_transactions_reporting_month'),
        ('transactions', 'ix_transactions_wallet_reporting_month'),
        ('transactions', 'ix_transactions_user_reporting_month'),
    ):
        op.drop_index(name, table_name=table)
    with op.batch_alter_table('planned_transactions') as batch:
        batch.drop_column('reporting_month')
    with op.batch_alter_table('transactions') as batch:
        batch.drop_column('reporting_month')
    op.drop_column('wallets', 'card_network')
