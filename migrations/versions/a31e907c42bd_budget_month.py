"""Allow a budget to target a reporting month; existing budgets keep repeating."""
from alembic import op
import sqlalchemy as sa

revision = 'a31e907c42bd'
down_revision = 'f20c846d9a31'
branch_labels = None
depends_on = None


def upgrade():
    columns = {column['name'] for column in sa.inspect(op.get_bind()).get_columns('budgets')}
    if 'reporting_month' not in columns:
        op.add_column('budgets', sa.Column('reporting_month', sa.String(7), nullable=True))


def downgrade():
    with op.batch_alter_table('budgets') as batch:
        batch.drop_column('reporting_month')
