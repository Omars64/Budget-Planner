"""Add opt-in device update push subscriptions; no financial tables change."""
from alembic import op
import sqlalchemy as sa

revision = 'f31b248da902'
down_revision = 'd81b530e97ac'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    if sa.inspect(bind).has_table('update_push_devices'):
        return
    op.create_table('update_push_devices',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('platform', sa.String(10), nullable=False), sa.Column('payload', sa.Text(), nullable=False),
        sa.Column('installed_version', sa.String(30), nullable=False), sa.Column('last_version', sa.String(30)),
        sa.Column('updated_at', sa.DateTime(), nullable=False))
    op.create_index('ix_update_push_devices_user_id', 'update_push_devices', ['user_id'])


def downgrade():
    op.drop_table('update_push_devices')
