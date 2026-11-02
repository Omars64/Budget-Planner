"""Account-scoped notes, explicit collaborator permissions, and feedback inbox."""
import base64
import binascii
import re
from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import or_
from sqlalchemy.orm import Session

from .database import get_db
from .spaces import workspace_user
from .index import current_user, admin_user, normalize_email, set_setting, setting
from .models import Note, NoteFolder, NoteShare, Feedback, FeedbackComment, User, utc_now
from .models import RecoveryPoint, NoteRevision
from .data_safety import save_recovery, clear_budget, clear_notes
import json
import hashlib
import uuid
from sqlalchemy.exc import IntegrityError

router = APIRouter()


NOTE_ATTACHMENT_MIMES = frozenset({
    'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp', 'image/avif',
    'application/pdf', 'text/plain', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
})
MAX_NOTE_ATTACHMENT_BYTES = 4 * 1024 * 1024


def validate_note_attachment(attachment_data, attachment_type, note_type='text'):
    """Validate the URL boundary, not the contents of downloaded documents."""
    if attachment_data is None or attachment_data == '':
        return
    if not isinstance(attachment_data, str) or len(attachment_data) > 6_000_000:
        raise ValueError('Invalid attachment data URL')
    match = re.fullmatch(r'data:([a-z0-9.+-]+/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})',
                         attachment_data, flags=re.IGNORECASE)
    mime = attachment_type.lower() if isinstance(attachment_type, str) else None
    if not match or mime not in NOTE_ATTACHMENT_MIMES or match[1].lower() != mime:
        raise ValueError('Choose a supported base64 file attachment with a matching type')
    if note_type == 'drawing' and mime != 'image/png':
        raise ValueError('Drawings must use PNG attachments')
    encoded = match[2]
    if len(encoded) % 4:
        raise ValueError('Invalid attachment base64')
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as error:
        raise ValueError('Invalid attachment base64') from error
    if not raw or len(raw) > MAX_NOTE_ATTACHMENT_BYTES:
        raise ValueError('Attachments must be smaller than 4 MB')


class FolderIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    color: str = Field(default="#0a4173", max_length=20)


class NoteIn(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    content: str = Field(default="", max_length=100000)
    folder_id: int | None = Field(default=None, gt=0)
    pinned: bool = False
    note_type: Literal["text", "checklist", "drawing"] = "text"
    color: str = Field(default="#ffffff", max_length=20)
    page_style: Literal["plain", "lined", "grid"] = "plain"
    checklist: list[dict] = Field(default_factory=list, max_length=200)
    attachment_name: str | None = Field(default=None, max_length=180)
    attachment_type: str | None = Field(default=None, max_length=120)
    attachment_data: str | None = Field(default=None, max_length=6000000)
    version: int = Field(default=1, ge=1)

    @model_validator(mode='after')
    def valid_attachment(self):
        validate_note_attachment(self.attachment_data, self.attachment_type, self.note_type)
        return self


class ShareIn(BaseModel):
    email: str = Field(min_length=3, max_length=160)
    permission: Literal["view", "edit"] = "view"


class FeedbackIn(BaseModel):
    subject: str = Field(min_length=1, max_length=160)
    content: str = Field(min_length=1, max_length=10000)
    category: Literal["suggestion", "bug", "question"] = "suggestion"


class FeedbackUpdate(BaseModel):
    status: Literal["new", "reviewing", "resolved"]
    reply: str | None = Field(default=None, max_length=10000)
    revision: str | None = Field(default=None, max_length=64)


class FeedbackRead(BaseModel):
    reply_revision: str = Field(min_length=64, max_length=64)


class FeedbackCommentIn(BaseModel):
    content: str = Field(min_length=1, max_length=10000)
    request_id: str = Field(min_length=36, max_length=36, pattern=r'^[a-f0-9-]{36}$')


class RatingIn(BaseModel):
    stars: int = Field(ge=1, le=5)
    comment: str = Field(default='', max_length=2000)


def count_feedback_event(db, user_id):
    db.query(User).filter_by(id=user_id).with_for_update().first()
    count = int(setting(db, user_id, 'feedback_prompt_events', '0')) + 1
    set_setting(db, user_id, 'feedback_prompt_events', str(count))
    return count


@router.get('/api/feedback/prompt')
def feedback_prompt(user=Depends(current_user), db: Session = Depends(get_db)):
    count = int(setting(db, user.id, 'feedback_prompt_events', '0'))
    dismissed = int(setting(db, user.id, 'feedback_prompt_dismissed', '0'))
    rated = setting(db, user.id, 'feedback_rating_received', 'false') == 'true'
    return {'show': not rated and count - dismissed >= 3, 'show_after_next_event': not rated and count + 1 - dismissed >= 3, 'rated': rated, 'events': count}


@router.post('/api/feedback/prompt/dismiss')
def dismiss_feedback_prompt(next_event: bool = False, user=Depends(current_user), db: Session = Depends(get_db)):
    count = int(setting(db, user.id, 'feedback_prompt_events', '0'))
    set_setting(db, user.id, 'feedback_prompt_dismissed', str(count + int(next_event)))
    db.commit()
    return {'ok': True}


@router.post('/api/feedback/rating', status_code=201)
def rate_app(payload: RatingIn, user=Depends(current_user), db: Session = Depends(get_db)):
    db.query(User).filter_by(id=user.id).with_for_update().first()
    if setting(db, user.id, 'feedback_rating_received', 'false') == 'true':
        raise HTTPException(409, 'Your rating was already received.')
    row = Feedback(user_id=user.id, subject=f'App rating: {payload.stars}/5',
                   content=payload.comment.strip() or 'No comment', category='rating')
    db.add(row)
    set_setting(db, user.id, 'feedback_rating_received', 'true')
    db.commit()
    return feedback_payload(db, row)


class ClearWorkspaceIn(BaseModel):
    confirmation: Literal["CLEAR"]
    scope: Literal["budget", "workspace"] = "budget"


@router.get("/api/recovery")
def recovery(user=Depends(current_user), db: Session = Depends(get_db)):
    return [{"id": r.id, "reason": r.reason, "created_at": r.created_at.isoformat() + "Z"} for r in db.query(RecoveryPoint).filter_by(user_id=user.id).order_by(RecoveryPoint.id.desc()).all()]


@router.get("/api/recovery/{point_id}")
def download_recovery(point_id: int, user=Depends(current_user), db: Session = Depends(get_db)):
    row = db.query(RecoveryPoint).filter_by(id=point_id, user_id=user.id).first()
    if not row: raise HTTPException(404, "Recovery copy not found")
    return json.loads(row.payload)


@router.delete("/api/recovery/{point_id}", status_code=204)
def delete_recovery(point_id: int, user=Depends(current_user), db: Session = Depends(get_db)):
    row = db.query(RecoveryPoint).filter_by(id=point_id, user_id=user.id).with_for_update().first()
    if not row:
        raise HTTPException(404, "Recovery copy not found")
    from .account_security import audit
    audit(db, user.id, user.id, "Deleted recovery copy", f"recovery:{row.id}")
    db.delete(row)
    db.commit()


@router.post("/api/workspace/clear")
def clear_workspace(payload: ClearWorkspaceIn, request: Request, user=Depends(current_user), db: Session = Depends(get_db)):
    from .account_security import confirmed
    confirmed(request, db, user)
    point = save_recovery(db, user, user, f"Cleared {payload.scope}")
    clear_budget(db, user.id, preserve_main_wallet=True, preserve_categories=True)
    if payload.scope == "workspace": clear_notes(db, user.id)
    set_setting(db, user.id, "workspace_initialized", "true")
    db.commit()
    return {"ok": True, "recovery_id": point.id}


def nonblank(value):
    if not value.strip():
        raise HTTPException(422, "Please enter text before saving")
    return value.strip()


def note_access(db, user, note_id, edit=False, owner=False):
    note = db.query(Note).filter(Note.id == note_id).with_for_update().first()
    share = db.query(NoteShare).filter_by(note_id=note_id, member_id=user.id).first()
    if not note or (note.user_id != user.id and not share):
        raise HTTPException(404, "Note not found")
    if note.user_id != user.id and (owner or (edit and share.permission != "edit")):
        raise HTTPException(403, "You do not have permission to change this note")
    return note


def clean_color(value, fallback="#ffffff"):
    value = (value or fallback).strip()
    if value.startswith("#") and len(value) in {4, 7} and all(char in "0123456789abcdefABCDEF" for char in value[1:]):
        return value
    if value in {"paper", "blue", "green", "yellow", "rose", "violet"}:
        return value
    return fallback


def clean_checklist(items):
    cleaned = []
    for index, item in enumerate(items or []):
        if not isinstance(item, dict):
            continue
        text = str(item.get("text", "")).strip()[:500]
        if not text:
            continue
        cleaned.append({"id": str(item.get("id") or index + 1)[:80], "text": text, "done": bool(item.get("done"))})
    return cleaned[:200]


def note_payload(db, user, note, include_attachment=False):
    owner = db.get(User, note.user_id)
    shares = db.query(NoteShare).filter_by(note_id=note.id).all()
    mine = note.user_id == user.id
    access = next((s for s in shares if s.member_id == user.id), None)
    try:
        checklist = json.loads(getattr(note, "checklist", "[]") or "[]")
        if not isinstance(checklist, list): checklist = []
    except (TypeError, ValueError):
        checklist = []
    payload = {"id": note.id, "title": note.title, "content": note.content,
            "folder_id": note.folder_id if mine else None, "pinned": note.pinned,
            "note_type": getattr(note, "note_type", "text"),
            "color": getattr(note, "color", "#ffffff"),
            "page_style": getattr(note, "page_style", "plain"),
            "checklist": checklist,
            "attachment_name": getattr(note, "attachment_name", None),
            "attachment_type": getattr(note, "attachment_type", None),
            "version": note.version, "updated_at": note.updated_at.isoformat() + "Z",
            "owner_name": owner.username, "is_owner": mine,
            "can_edit": mine or bool(access and access.permission == "edit"),
            "shares": [{"id": s.id, "email": db.get(User, s.member_id).email,
                        "permission": s.permission} for s in shares] if mine else []}
    if include_attachment:
        payload["attachment_data"] = getattr(note, "attachment_data", None)
    context = db.info.get('space')
    if context and context.id is not None:
        payload['is_owner'] = context.role == 'owner'
        payload['can_edit'] = context.role in {'owner', 'edit'}
        payload['shares'] = []
    return payload


@router.get("/api/note-folders")
def folders(user=Depends(workspace_user), db: Session = Depends(get_db)):
    return db.query(NoteFolder).filter_by(user_id=user.id).order_by(NoteFolder.name).all()


@router.post("/api/note-folders", status_code=201)
def create_folder(payload: FolderIn, user=Depends(workspace_user), db: Session = Depends(get_db)):
    row = NoteFolder(user_id=user.id, name=nonblank(payload.name), color=clean_color(payload.color, "#0a4173"))
    db.add(row); db.commit(); db.refresh(row)
    return row


@router.put("/api/note-folders/{folder_id}")
def rename_folder(folder_id: int, payload: FolderIn, user=Depends(workspace_user), db: Session = Depends(get_db)):
    row = db.query(NoteFolder).filter_by(id=folder_id, user_id=user.id).first()
    if not row: raise HTTPException(404, "Folder not found")
    row.name = nonblank(payload.name); row.color = clean_color(payload.color, row.color); db.commit(); db.refresh(row)
    return row


@router.delete("/api/note-folders/{folder_id}", status_code=204)
def delete_folder(folder_id: int, user=Depends(workspace_user), db: Session = Depends(get_db)):
    row = db.query(NoteFolder).filter_by(id=folder_id, user_id=user.id).first()
    if not row: raise HTTPException(404, "Folder not found")
    db.query(Note).filter_by(folder_id=folder_id, user_id=user.id).update({Note.folder_id: None, Note.version: Note.version + 1})
    db.delete(row); db.commit()


@router.get("/api/notes")
def notes(user=Depends(workspace_user), db: Session = Depends(get_db)):
    shared = db.query(NoteShare.note_id).filter_by(member_id=user.id)
    rows = db.query(Note).filter(or_(Note.user_id == user.id, Note.id.in_(shared))).order_by(Note.pinned.desc(), Note.updated_at.desc()).all()
    return [note_payload(db, user, note) for note in rows]


@router.post("/api/notes", status_code=201)
def create_note(payload: NoteIn, user=Depends(workspace_user), db: Session = Depends(get_db)):
    if payload.folder_id and not db.query(NoteFolder).filter_by(id=payload.folder_id, user_id=user.id).first():
        raise HTTPException(404, "Folder not found")
    if payload.attachment_data and not payload.attachment_type:
        raise HTTPException(422, "Please include the attachment type")
    row = Note(user_id=user.id, title=nonblank(payload.title), content=payload.content, folder_id=payload.folder_id,
               pinned=payload.pinned, note_type=payload.note_type, color=clean_color(payload.color),
               page_style=payload.page_style, checklist=json.dumps(clean_checklist(payload.checklist)),
               attachment_name=payload.attachment_name, attachment_type=payload.attachment_type,
               attachment_data=payload.attachment_data)
    db.add(row); db.commit(); db.refresh(row)
    return note_payload(db, user, row, include_attachment=True)


@router.get("/api/notes/{note_id}")
def get_note(note_id: int, user=Depends(workspace_user), db: Session = Depends(get_db)):
    row = note_access(db, user, note_id)
    return note_payload(db, user, row, include_attachment=True)


@router.put("/api/notes/{note_id}")
def update_note(note_id: int, payload: NoteIn, user=Depends(workspace_user), db: Session = Depends(get_db)):
    row = note_access(db, user, note_id, edit=True)
    if row.version != payload.version:
        raise HTTPException(409, "This note changed since you opened it. Copy your draft, then reload the latest version.")
    if payload.attachment_data and not payload.attachment_type:
        raise HTTPException(422, "Please include the attachment type")
    db.add(NoteRevision(note_id=row.id, title=row.title, content=row.content, version=row.version))
    if row.user_id == user.id:
        if payload.folder_id and not db.query(NoteFolder).filter_by(id=payload.folder_id, user_id=user.id).first():
            raise HTTPException(404, "Folder not found")
        row.folder_id = payload.folder_id; row.pinned = payload.pinned
    row.title = nonblank(payload.title); row.content = payload.content
    row.note_type = payload.note_type; row.color = clean_color(payload.color)
    row.page_style = payload.page_style; row.checklist = json.dumps(clean_checklist(payload.checklist))
    row.attachment_name = payload.attachment_name; row.attachment_type = payload.attachment_type
    row.attachment_data = payload.attachment_data
    row.version += 1; row.updated_at = utc_now()
    db.commit(); db.refresh(row)
    return note_payload(db, user, row, include_attachment=True)


@router.delete("/api/notes/{note_id}", status_code=204)
def delete_note(note_id: int, user=Depends(workspace_user), db: Session = Depends(get_db)):
    row = note_access(db, user, note_id, owner=True)
    save_recovery(db, user, user, f"Deleted note: {row.title}")
    from .recovery import trash
    trash(db, row, user, 'note')
    db.query(NoteRevision).filter_by(note_id=note_id).delete()
    db.query(NoteShare).filter_by(note_id=note_id).delete()
    db.delete(row); db.commit()


@router.get("/api/notes/{note_id}/history")
def note_history(note_id: int, user=Depends(workspace_user), db: Session = Depends(get_db)):
    note_access(db, user, note_id, owner=True)
    rows = db.query(NoteRevision).filter_by(note_id=note_id).order_by(NoteRevision.id.desc()).limit(200).all()
    return [{"id": r.id, "title": r.title, "content": r.content, "version": r.version, "created_at": r.created_at.isoformat() + "Z"} for r in rows]


@router.post("/api/notes/{note_id}/shares", status_code=201)
def share_note(note_id: int, payload: ShareIn, user=Depends(workspace_user), db: Session = Depends(get_db)):
    note_access(db, user, note_id, owner=True)
    member = db.query(User).filter_by(email=normalize_email(payload.email), active=True).first()
    if not member: raise HTTPException(404, "Ask this person to create a Budgetly account first")
    if member.id == user.id: raise HTTPException(400, "You already own this note")
    row = db.query(NoteShare).filter_by(note_id=note_id, member_id=member.id).first()
    if not row:
        row = NoteShare(note_id=note_id, member_id=member.id); db.add(row)
    row.permission = payload.permission; db.commit()
    return {"ok": True}


@router.delete("/api/notes/{note_id}/shares/{share_id}", status_code=204)
def unshare_note(note_id: int, share_id: int, user=Depends(workspace_user), db: Session = Depends(get_db)):
    note_access(db, user, note_id, owner=True)
    row = db.query(NoteShare).filter_by(id=share_id, note_id=note_id).first()
    if not row: raise HTTPException(404, "Share not found")
    db.delete(row); db.commit()


def feedback_revision(row):
    return hashlib.sha256(json.dumps([row.id, row.status, row.reply]).encode()).hexdigest()


def reply_revision(row, comments=None):
    if comments is None:
        from sqlalchemy.orm import object_session
        session = object_session(row)
        comments = session.query(FeedbackComment).filter_by(feedback_id=row.id).order_by(FeedbackComment.created_at, FeedbackComment.id).all() if session else []
    admin_replies = [comment.id for comment in comments if comment.is_admin]
    text = row.reply or ''
    if admin_replies:
        text += json.dumps(admin_replies)
    return hashlib.sha256(text.encode()).hexdigest()


def feedback_payload(db, row, seen=None, comments=None):
    sender = db.get(User, row.user_id)
    if comments is None:
        comments = db.query(FeedbackComment).filter_by(feedback_id=row.id).order_by(FeedbackComment.created_at, FeedbackComment.id).all()
    thread = ([{'id': 'legacy', 'author_name': 'Budgetly', 'is_admin': True, 'content': row.reply, 'created_at': None}] if row.reply else [])
    thread += [{'id': c.id, 'author_name': c.author_name, 'is_admin': c.is_admin, 'content': c.content, 'created_at': c.created_at.isoformat() + 'Z'} for c in comments]
    revision = reply_revision(row, comments)
    return {"id": row.id, "subject": row.subject, "content": row.content,
            "category": row.category, "status": row.status, "reply": row.reply,
            "comments": thread, "revision": feedback_revision(row), "reply_revision": revision,
            "reply_unread": bool(any(c['is_admin'] for c in thread) and seen is not None and seen.get(f'feedback_read:{row.id}') != revision),
            "created_at": row.created_at.isoformat() + "Z", "sender_name": sender.username if sender else 'Deleted account', "sender_email": sender.email if sender else ''}


@router.post('/api/feedback/{feedback_id}/comments', status_code=201)
def post_feedback_comment(feedback_id: int, payload: FeedbackCommentIn, user=Depends(current_user), db: Session = Depends(get_db)):
    row = db.query(Feedback).filter_by(id=feedback_id).with_for_update().first()
    if not row or (user.role != 'admin' and row.user_id != user.id):
        raise HTTPException(404, 'Feedback not found')
    existing = db.get(FeedbackComment, payload.request_id)
    if existing:
        if existing.feedback_id != row.id or existing.author_id != user.id or existing.content != payload.content.strip():
            raise HTTPException(409, 'Reply identifier already used. Refresh and try again.')
    else:
        content = nonblank(payload.content)
        recent = db.query(FeedbackComment).filter(FeedbackComment.author_id == user.id, FeedbackComment.created_at > utc_now() - timedelta(minutes=1)).count()
        if recent >= 10:
            raise HTTPException(429, 'Please wait a minute before posting more replies')
        db.add(FeedbackComment(id=payload.request_id, feedback_id=row.id, author_id=user.id,
            author_name=user.username, is_admin=user.role == 'admin', content=content))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            existing = db.get(FeedbackComment, payload.request_id)
            if not existing or existing.feedback_id != row.id or existing.author_id != user.id or existing.content != content:
                raise HTTPException(409, 'Reply identifier already used. Refresh and try again.')
    return feedback_payload(db, row)


@router.get("/api/feedback")
def feedback(user=Depends(current_user), db: Session = Depends(get_db)):
    query = db.query(Feedback)
    if user.role != "admin": query = query.filter_by(user_id=user.id)
    from .models import AppSetting
    seen = None if user.role == 'admin' else {row.key: row.value for row in db.query(AppSetting).filter(
        AppSetting.user_id == user.id, AppSetting.key.like('feedback_read:%')).all()}
    rows = query.order_by(Feedback.created_at.desc()).all()
    threads = {row.id: [] for row in rows}
    if threads:
        for comment in db.query(FeedbackComment).filter(FeedbackComment.feedback_id.in_(threads)).order_by(FeedbackComment.created_at, FeedbackComment.id).all():
            threads[comment.feedback_id].append(comment)
    return [feedback_payload(db, r, seen, threads[r.id]) for r in rows]


@router.post('/api/feedback/{feedback_id}/read')
def read_feedback(feedback_id: int, payload: FeedbackRead, user=Depends(current_user), db: Session = Depends(get_db)):
    row = db.query(Feedback).filter_by(id=feedback_id, user_id=user.id).with_for_update().first()
    if not row:
        raise HTTPException(404, 'Feedback not found')
    if reply_revision(row) != payload.reply_revision:
        raise HTTPException(409, 'A newer reply is available. Refresh to read it.')
    set_setting(db, user.id, f'feedback_read:{row.id}', payload.reply_revision)
    db.commit()
    return feedback_payload(db, row, {f'feedback_read:{row.id}': payload.reply_revision})


@router.post("/api/feedback", status_code=201)
def send_feedback(payload: FeedbackIn, user=Depends(current_user), db: Session = Depends(get_db)):
    if user.role == "admin": raise HTTPException(403, "Administrators manage feedback through the inbox")
    # Lock the account so simultaneous submissions cannot bypass the rate limit.
    db.query(User).filter_by(id=user.id).with_for_update().first()
    recent = db.query(Feedback).filter(Feedback.user_id == user.id, Feedback.created_at > utc_now() - timedelta(minutes=1)).count()
    if recent >= 3: raise HTTPException(429, "Please wait a minute before sending more feedback")
    row = Feedback(user_id=user.id, subject=nonblank(payload.subject), content=nonblank(payload.content), category=payload.category)
    db.add(row); db.commit(); db.refresh(row)
    return feedback_payload(db, row)


@router.put("/api/feedback/{feedback_id}")
def update_feedback(feedback_id: int, payload: FeedbackUpdate, user=Depends(admin_user), db: Session = Depends(get_db)):
    row = db.get(Feedback, feedback_id)
    if not row: raise HTTPException(404, "Feedback not found")
    if payload.revision and payload.revision != feedback_revision(row):
        raise HTTPException(409, 'This feedback changed. Refresh before saving; your draft has been kept.')
    # Status-only changes, including older clients sending an empty textarea,
    # must never silently erase a reply already sent to the user.
    submitted = payload.reply.strip() if payload.reply else ''
    reply = submitted if submitted and not row.reply else row.reply
    # Older clients still use PUT to send replies. Preserve their previous
    # answer and append instead of replacing conversation history.
    if submitted and row.reply and submitted != row.reply:
        db.add(FeedbackComment(id=str(uuid.uuid4()), feedback_id=row.id, author_id=user.id,
            author_name=user.username, is_admin=True, content=submitted))
    changed = db.query(Feedback).filter_by(id=row.id, status=row.status, reply=row.reply).update(
        {'status': payload.status, 'reply': reply}, synchronize_session=False)
    if changed != 1:
        db.rollback()
        raise HTTPException(409, 'This feedback changed. Refresh before saving; your draft has been kept.')
    db.commit(); db.refresh(row)
    return feedback_payload(db, row)
