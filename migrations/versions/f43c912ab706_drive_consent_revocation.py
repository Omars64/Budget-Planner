"""Durable Drive revocation and initiating-session consent binding."""
from alembic import op
import sqlalchemy as sa
from api.models import ProviderRevocationJob

revision = 'f43c912ab706'
down_revision = 'e92a671bf304'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    ProviderRevocationJob.__table__.create(bind, checkfirst=True)
    additions = {
        'google_drive_connections': [sa.Column('generation', sa.Integer(), nullable=False, server_default='0')],
        'google_drive_oauth_attempts': [sa.Column('session_id', sa.String(64)),
            sa.Column('credential_digest', sa.String(64)),
            sa.Column('connection_generation', sa.Integer(), nullable=False, server_default='0')],
    }
    for table, columns in additions.items():
        existing = {c['name'] for c in sa.inspect(bind).get_columns(table)}
        for column in columns:
            if column.name not in existing:
                op.add_column(table, column)
    bind.execute(sa.text("UPDATE google_drive_oauth_attempts SET status='cancelled', verifier=NULL WHERE session_id IS NULL AND status IN ('pending','processing')"))


def downgrade():
    # Pending credentials must be drained before downgrading.
    if op.get_bind().execute(sa.text("SELECT count(*) FROM provider_revocation_jobs WHERE status='pending'")).scalar():
        raise RuntimeError('Drain pending provider revocations before downgrade')
    op.drop_table('provider_revocation_jobs')
    for table, names in [('google_drive_oauth_attempts', ['session_id', 'credential_digest', 'connection_generation']),
                         ('google_drive_connections', ['generation'])]:
        with op.batch_alter_table(table) as batch:
            for name in names:
                batch.drop_column(name)
