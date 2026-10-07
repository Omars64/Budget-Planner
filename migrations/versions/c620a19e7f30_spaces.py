"""Spaces: preserve existing wallet IDs, records and exact sharing groups."""
from alembic import op
import sqlalchemy as sa
from api.models import Space, SpaceMember
from api.spaces import migrate_shared_wallets

revision = 'c620a19e7f30'
down_revision = 'b915c820d431'
branch_labels = None
depends_on = None


def upgrade():
    connection = op.get_bind()
    Space.__table__.create(connection, checkfirst=True)
    SpaceMember.__table__.create(connection, checkfirst=True)
    for table in ('wallets', 'categories', 'budgets', 'goals', 'debts', 'notes', 'note_folders'):
        columns = {c['name'] for c in sa.inspect(connection).get_columns(table)}
        if 'space_id' not in columns:
            op.add_column(table, sa.Column('space_id', sa.Integer(), nullable=True))
        indexes = {i['name'] for i in sa.inspect(connection).get_indexes(table)}
        name = f'ix_{table}_space_id'
        if name not in indexes:
            op.create_index(name, table, ['space_id'])
        if connection.dialect.name != 'sqlite':
            foreign = sa.inspect(connection).get_foreign_keys(table)
            if not any(f['constrained_columns'] == ['space_id'] for f in foreign):
                op.create_foreign_key(f'fk_{table}_space_id', table, 'spaces', ['space_id'], ['id'])
    migrate_shared_wallets(connection)


def downgrade():
    raise RuntimeError('Spaces cannot be downgraded automatically. Restore a verified pre-upgrade database backup.')
