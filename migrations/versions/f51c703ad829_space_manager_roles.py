"""Retire Space Contributor in favor of Manager; keep all financial rows intact."""
from alembic import op
import sqlalchemy as sa

revision = 'f51c703ad829'
down_revision = 'f43c912ab706'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    bind.execute(sa.text("UPDATE space_members SET role='edit' WHERE role='add'"))
    bind.execute(sa.text("UPDATE wallet_shares SET permission='edit' WHERE permission='add' "
                         "AND wallet_id IN (SELECT id FROM wallets WHERE space_id IS NOT NULL)"))


def downgrade():
    # Original Contributors cannot be distinguished from newly appointed Managers.
    # Keep their current permissions rather than guessing and removing access.
    pass
