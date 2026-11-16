"""Add separate debt spaces, access grants, and personal reminder settings."""
from alembic import op
from api.models import DebtSpace, DebtSpaceAlert, DebtSpaceMember

revision = 'd69c21d23ceb'
down_revision = 'f95d143fe276'
branch_labels = None
depends_on = None


def upgrade():
    for model in (DebtSpace, DebtSpaceMember, DebtSpaceAlert):
        model.__table__.create(op.get_bind(), checkfirst=True)


def downgrade():
    # Older releases ignore these tables. Keep debt records and memberships.
    pass
