"""Add the optional wallet card finish, preserving all existing colors."""
from alembic import op
import sqlalchemy as sa

revision = 'f84c032ed165'
down_revision = 'f73b921cd054'
branch_labels = None
depends_on = None


def upgrade():
    columns = {column['name'] for column in sa.inspect(op.get_bind()).get_columns('wallets')}
    if 'card_finish' not in columns:
        op.add_column('wallets', sa.Column('card_finish', sa.String(12), nullable=True))


def downgrade():
    # Keep appearance choices available if the release is rolled back.
    pass
