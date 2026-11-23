"""Store administrator announcements and per-account read status."""
from alembic import op
from api.models import AdminAnnouncement, AnnouncementRecipient

revision = 'b1db85db20c7'
down_revision = 'af224ca743ee'
branch_labels = depends_on = None


def upgrade():
    AdminAnnouncement.__table__.create(op.get_bind(), checkfirst=True)
    AnnouncementRecipient.__table__.create(op.get_bind(), checkfirst=True)


def downgrade():
    AnnouncementRecipient.__table__.drop(op.get_bind(), checkfirst=True)
    AdminAnnouncement.__table__.drop(op.get_bind(), checkfirst=True)
