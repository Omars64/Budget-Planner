"""Stage bounded workbook transfers across API requests."""
from alembic import op
from api.models import WorkbookTransfer

revision = 'ce7fd969ab1b'
down_revision = 'b1db85db20c7'
branch_labels = depends_on = None


def upgrade():
    WorkbookTransfer.__table__.create(op.get_bind(), checkfirst=True)


def downgrade():
    WorkbookTransfer.__table__.drop(op.get_bind(), checkfirst=True)
