"""Add review-only bank candidates, wallet routing and merchant memory."""
from alembic import op
from api.models import BankCandidate, BankSourceMapping, BankMerchantMemory

revision = 'd730b28a1901'
down_revision = 'c620a19e7f30'
branch_labels = None
depends_on = None


def upgrade():
    for model in (BankCandidate, BankSourceMapping, BankMerchantMemory):
        model.__table__.create(op.get_bind(), checkfirst=True)


def downgrade():
    raise RuntimeError('Export bank inbox data before a manual downgrade.')
