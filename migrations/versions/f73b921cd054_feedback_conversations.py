"""Add private feedback conversations; retain every existing legacy reply."""
from alembic import op
from api.models import FeedbackComment

revision = 'f73b921cd054'
down_revision = 'f62a810bc943'
branch_labels = None
depends_on = None


def upgrade():
    FeedbackComment.__table__.create(op.get_bind(), checkfirst=True)


def downgrade():
    # Keep conversations across a code rollback.
    pass
