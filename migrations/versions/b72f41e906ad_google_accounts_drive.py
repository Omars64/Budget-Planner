"""Add Google identities and optional Drive connections without changing records."""
from alembic import op
from api.database import Base
from api import google_auth, google_drive  # noqa: F401

revision = 'b72f41e906ad'
down_revision = 'a31e907c42bd'
branch_labels = None
depends_on = None


def upgrade():
    for name in ('google_identities', 'google_auth_states', 'google_drive_connections', 'google_drive_oauth_attempts'):
        Base.metadata.tables[name].create(op.get_bind(), checkfirst=True)


def downgrade():
    for name in ('google_drive_oauth_attempts', 'google_drive_connections', 'google_auth_states', 'google_identities'):
        Base.metadata.tables[name].drop(op.get_bind(), checkfirst=True)
