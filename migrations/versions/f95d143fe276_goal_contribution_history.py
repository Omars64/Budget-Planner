"""Keep goal contributions recorded after this release."""
import sqlalchemy as sa
from alembic import op

revision = 'f95d143fe276'
down_revision = 'f84c032ed165'
branch_labels = None
depends_on = None


def upgrade():
    if 'contribution_history' not in {column['name'] for column in sa.inspect(op.get_bind()).get_columns('goals')}:
        op.add_column('goals', sa.Column('contribution_history', sa.JSON(), nullable=True))


def downgrade():
    # Older releases ignore the history column. Keep recorded contributions.
    pass
