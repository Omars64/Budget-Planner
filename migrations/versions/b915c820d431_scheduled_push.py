"""Durable opt-in scheduled-entry notification outbox."""
from alembic import op
from api.database import Base
from api.update_push import ScheduledPush

revision = 'b915c820d431'
down_revision = 'a60917bc82ef'
branch_labels = None
depends_on = None


def upgrade():
    ScheduledPush.__table__.create(op.get_bind(), checkfirst=True)


def downgrade():
    Base.metadata.tables['scheduled_push_outbox'].drop(op.get_bind(), checkfirst=True)
