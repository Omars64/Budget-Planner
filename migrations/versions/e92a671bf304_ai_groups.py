"""Private assistant groups; existing conversations remain ungrouped."""
from alembic import op
import sqlalchemy as sa

revision = 'e92a671bf304'
down_revision = 'd730b28a1901'
branch_labels = None
depends_on = None


def upgrade():
    from api.ai_models import AIGroup
    AIGroup.__table__.create(op.get_bind(), checkfirst=True)
    if 'group_id' not in {c['name'] for c in sa.inspect(op.get_bind()).get_columns('ai_chats')}:
        with op.batch_alter_table('ai_chats') as batch:
            batch.add_column(sa.Column('group_id', sa.String(36), nullable=True))
            batch.create_foreign_key('fk_ai_chat_group', 'ai_groups', ['group_id'], ['id'], ondelete='SET NULL')
            batch.create_index('ix_ai_chats_group_id', ['group_id'])
    elif 'ix_ai_chats_group_id' not in {index['name'] for index in sa.inspect(op.get_bind()).get_indexes('ai_chats')}:
        op.create_index('ix_ai_chats_group_id', 'ai_chats', ['group_id'])


def downgrade():
    raise RuntimeError('Export assistant groups before a manual downgrade.')
