"""Retain encrypted Google credentials solely for account-deletion revocation."""
from alembic import op
from api.google_auth import GoogleRevocationCredential

revision = 'd81b530e97ac'
down_revision = 'b72f41e906ad'
branch_labels = None
depends_on = None


def upgrade():
    GoogleRevocationCredential.__table__.create(op.get_bind(), checkfirst=True)


def downgrade():
    GoogleRevocationCredential.__table__.drop(op.get_bind(), checkfirst=True)
