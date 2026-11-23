"""In-app announcements addressed to active Budgetly accounts."""
import json
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, StringConstraints
from sqlalchemy import func, insert, literal, select, update
from sqlalchemy.orm import Session

from .auth_dependency import admin_user, current_user
from .database import get_db
from .idempotency import reserve
from .models import AdminAnnouncement, AnnouncementRecipient, User, utc_now

router = APIRouter()
page_size = 30


class AnnouncementInput(BaseModel):
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
    message: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
    audience: Literal['everyone', 'users', 'admins']


def item(row):
    return dict(id=row.id, title=row.title, message=row.message, created_at=row.created_at.isoformat() + 'Z')


def sent_item(row):
    return dict(**item(row), audience=row.audience, recipient_count=row.recipient_count)


@router.post('/api/admin/announcements')
def send_announcement(payload: AnnouncementInput, request: Request, admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    receipt, previous = reserve(db, admin.id, 'admin-announcement', request.headers.get('Idempotency-Key'), payload)
    if previous is not None:
        return previous

    selected = select(User.id).where(User.active.is_(True), User.id != admin.id)
    if payload.audience != 'everyone':
        selected = selected.where(User.role == ('admin' if payload.audience == 'admins' else 'user'))
    announcement = AdminAnnouncement(sender_id=admin.id, **payload.model_dump(), recipient_count=0)
    db.add(announcement)
    db.flush()
    db.execute(insert(AnnouncementRecipient.__table__).from_select(
        ['user_id', 'announcement_id'], selected.add_columns(literal(announcement.id)),
    ))
    announcement.recipient_count = db.scalar(select(func.count()).select_from(AnnouncementRecipient).where(
        AnnouncementRecipient.announcement_id == announcement.id,
    ))
    if not announcement.recipient_count:
        db.rollback()
        raise HTTPException(422, 'There are no active recipients in this audience.')
    result = jsonable_encoder(sent_item(announcement))
    if receipt:
        receipt.response = json.dumps(result)
    db.commit()
    return result


@router.get('/api/admin/announcements')
def sent_announcements(response: Response, _: User = Depends(admin_user), db: Session = Depends(get_db)):
    response.headers['Cache-Control'] = 'private, no-store'
    rows = db.scalars(select(AdminAnnouncement).order_by(AdminAnnouncement.id.desc()).limit(page_size))
    return [sent_item(row) for row in rows]


@router.get('/api/announcements/unread')
def unread_announcements(response: Response, user: User = Depends(current_user), db: Session = Depends(get_db)):
    response.headers['Cache-Control'] = 'private, no-store'
    count = db.scalar(select(func.count()).select_from(AnnouncementRecipient).where(
        AnnouncementRecipient.user_id == user.id, AnnouncementRecipient.read_at.is_(None),
    ))
    return {'count': count}


@router.get('/api/announcements')
def received_announcements(
    response: Response, before: int | None = Query(None, gt=0),
    user: User = Depends(current_user), db: Session = Depends(get_db),
):
    response.headers['Cache-Control'] = 'private, no-store'
    query = select(AdminAnnouncement, AnnouncementRecipient.read_at).join(AnnouncementRecipient).where(
        AnnouncementRecipient.user_id == user.id,
    )
    if before:
        query = query.where(AnnouncementRecipient.announcement_id < before)
    rows = db.execute(query.order_by(AnnouncementRecipient.announcement_id.desc()).limit(page_size + 1)).all()
    return {
        'items': [dict(**item(row), read=read_at is not None) for row, read_at in rows[:page_size]],
        'next': rows[page_size - 1][0].id if len(rows) > page_size else None,
    }


@router.put('/api/announcements/{announcement_id}/read')
def read_announcement(announcement_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    recipient = db.get(AnnouncementRecipient, (user.id, announcement_id))
    if not recipient:
        raise HTTPException(404, 'Announcement not found')
    db.execute(update(AnnouncementRecipient).where(
        AnnouncementRecipient.user_id == user.id,
        AnnouncementRecipient.announcement_id == announcement_id,
        AnnouncementRecipient.read_at.is_(None),
    ).values(read_at=utc_now()))
    db.commit()
    return {'read': True}
