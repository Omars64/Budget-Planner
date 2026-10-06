"""Private receipt attachments on existing transactions."""
from alembic import op
import sqlalchemy as sa

revision = 'a60917bc82ef'
down_revision = 'f31b248da902'
branch_labels = None
depends_on = None

def upgrade():
    if sa.inspect(op.get_bind()).has_table('transaction_receipts'):
        return
    op.create_table('transaction_receipts',
        sa.Column('transaction_id',sa.Integer(),sa.ForeignKey('transactions.id',ondelete='CASCADE'),primary_key=True),
        sa.Column('name',sa.String(180),nullable=False),
        sa.Column('image',sa.Text(),nullable=False),
        sa.Column('saved_at',sa.DateTime(),nullable=False))

def downgrade():
    op.drop_table('transaction_receipts')
