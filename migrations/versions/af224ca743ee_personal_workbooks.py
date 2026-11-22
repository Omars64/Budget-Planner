"""Store private editable workbooks."""
from alembic import op
from api.models import Workbook

revision = 'af224ca743ee'
down_revision = 'd69c21d23ceb'
branch_labels = depends_on = None

def upgrade():
    Workbook.__table__.create(op.get_bind(), checkfirst=True)

def downgrade():
    pass
