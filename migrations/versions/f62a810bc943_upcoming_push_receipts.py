"""Add reminder delivery receipts without modifying existing records."""
from alembic import op
import sqlalchemy as sa

revision = 'f62a810bc943'
down_revision = 'f51c703ad829'
branch_labels = None
depends_on = None


def upgrade():
    table = sa.Table(
        'upcoming_push_receipts', sa.MetaData(),
        sa.Column('device_id', sa.String(36), nullable=False),
        sa.Column('occurrence', sa.String(64), nullable=False),
        sa.Column('sent_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('device_id', 'occurrence'),
    )
    # Reflect the referenced table so checkfirst also supports legacy installations.
    sa.Table('update_push_devices', table.metadata, autoload_with=op.get_bind())
    table.append_constraint(sa.ForeignKeyConstraint(
        ['device_id'], ['update_push_devices.id'], ondelete='CASCADE'))
    table.create(op.get_bind(), checkfirst=True)


def downgrade():
    # Keep delivery history to avoid duplicate reminders after a rollback.
    pass
