"""Account-scoped notes, explicit collaborator permissions, and feedback inbox."""
from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session

from .database import get_db
from .index import current_user, admin_user, normalize_email, set_setting
from .models import Note, NoteFolder, NoteShare, Feedback, User, utc_now
from .models import RecoveryPoint, NoteRevision
from .data_safety import save_recovery, clear_budget, clear_notes
import json

router = APIRouter()


class FolderIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class NoteIn(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    content: str = Field(default="", max_length=100000)
    folder_id: int | None = Field(default=None, gt=0)
    pinned: bool = False
    version: int = Field(default=1, ge=1)


class ShareIn(BaseModel):
    email: str = Field(min_length=3, max_length=160)
    permission: Literal["view", "edit"] = "view"


class FeedbackIn(BaseModel):
    subject: str = Field(min_length=1, max_length=160)
    content: str = Field(min_length=1, max_length=10000)
    category: Literal["suggestion", "bug", "question"] = "suggestion"


class FeedbackUpdate(BaseModel):
    status: Literal["new", "reviewing", "resolved"]
    reply: str = Field(default="", max_length=10000)


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


def note_payload(db, user, note):
    owner = db.get(User, note.user_id)
    shares = db.query(NoteShare).filter_by(note_id=note.id).all()
    mine = note.user_id == user.id
    access = next((s for s in shares if s.member_id == user.id), None)
    return {"id": note.id, "title": note.title, "content": note.content,
            "folder_id": note.folder_id if mine else None, "pinned": note.pinned,
            "version": note.version, "updated_at": note.updated_at.isoformat() + "Z",
            "owner_name": owner.username, "is_owner": mine,
            "can_edit": mine or bool(access and access.permission == "edit"),
            "shares": [{"id": s.id, "email": db.get(User, s.member_id).email,
                        "permission": s.permission} for s in shares] if mine else []}


@router.get("/api/note-folders")
def folders(user=Depends(current_user), db: Session = Depends(get_db)):
    return db.query(NoteFolder).filter_by(user_id=user.id).order_by(NoteFolder.name).all()


@router.post("/api/note-folders", status_code=201)
def create_folder(payload: FolderIn, user=Depends(current_user), db: Session = Depends(get_db)):
    row = NoteFolder(user_id=user.id, name=nonblank(payload.name))
    db.add(row); db.commit(); db.refresh(row)
    return row


@router.put("/api/note-folders/{folder_id}")
def rename_folder(folder_id: int, payload: FolderIn, user=Depends(current_user), db: Session = Depends(get_db)):
    row = db.query(NoteFolder).filter_by(id=folder_id, user_id=user.id).first()
    if not row: raise HTTPException(404, "Folder not found")
    row.name = nonblank(payload.name); db.commit(); db.refresh(row)
    return row


@router.delete("/api/note-folders/{folder_id}", status_code=204)
def delete_folder(folder_id: int, user=Depends(current_user), db: Session = Depends(get_db)):
    row = db.query(NoteFolder).filter_by(id=folder_id, user_id=user.id).first()
    if not row: raise HTTPException(404, "Folder not found")
    db.query(Note).filter_by(folder_id=folder_id, user_id=user.id).update({Note.folder_id: None, Note.version: Note.version + 1})
    db.delete(row); db.commit()


@router.get("/api/notes")
def notes(user=Depends(current_user), db: Session = Depends(get_db)):
    shared = db.query(NoteShare.note_id).filter_by(member_id=user.id)
    rows = db.query(Note).filter(or_(Note.user_id == user.id, Note.id.in_(shared))).order_by(Note.pinned.desc(), Note.updated_at.desc()).all()
    return [note_payload(db, user, note) for note in rows]


@router.post("/api/notes", status_code=201)
def create_note(payload: NoteIn, user=Depends(current_user), db: Session = Depends(get_db)):
    if payload.folder_id and not db.query(NoteFolder).filter_by(id=payload.folder_id, user_id=user.id).first():
        raise HTTPException(404, "Folder not found")
    row = Note(user_id=user.id, title=nonblank(payload.title), content=payload.content, folder_id=payload.folder_id, pinned=payload.pinned)
    db.add(row); db.commit(); db.refresh(row)
    return note_payload(db, user, row)


@router.put("/api/notes/{note_id}")
def update_note(note_id: int, payload: NoteIn, user=Depends(current_user), db: Session = Depends(get_db)):
    row = note_access(db, user, note_id, edit=True)
    if row.version != payload.version:
        raise HTTPException(409, "This note changed since you opened it. Copy your draft, then reload the latest version.")
    db.add(NoteRevision(note_id=row.id, title=row.title, content=row.content, version=row.version))
    if row.user_id == user.id:
        if payload.folder_id and not db.query(NoteFolder).filter_by(id=payload.folder_id, user_id=user.id).first():
            raise HTTPException(404, "Folder not found")
        row.folder_id = payload.folder_id; row.pinned = payload.pinned
    row.title = nonblank(payload.title); row.content = payload.content
    row.version += 1; row.updated_at = utc_now()
    db.commit(); db.refresh(row)
    return note_payload(db, user, row)


@router.delete("/api/notes/{note_id}", status_code=204)
def delete_note(note_id: int, user=Depends(current_user), db: Session = Depends(get_db)):
    row = note_access(db, user, note_id, owner=True)
    save_recovery(db, user, user, f"Deleted note: {row.title}")
    from .recovery import trash
    trash(db, row, user, 'note')
    db.query(NoteRevision).filter_by(note_id=note_id).delete()
    db.query(NoteShare).filter_by(note_id=note_id).delete()
    db.delete(row); db.commit()


@router.get("/api/notes/{note_id}/history")
def note_history(note_id: int, user=Depends(current_user), db: Session = Depends(get_db)):
    note_access(db, user, note_id, owner=True)
    return [{"id": r.id, "title": r.title, "content": r.content, "version": r.version, "created_at": r.created_at.isoformat() + "Z"} for r in db.query(NoteRevision).filter_by(note_id=note_id).order_by(NoteRevision.id.desc()).all()]


@router.post("/api/notes/{note_id}/shares", status_code=201)
def share_note(note_id: int, payload: ShareIn, user=Depends(current_user), db: Session = Depends(get_db)):
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
def unshare_note(note_id: int, share_id: int, user=Depends(current_user), db: Session = Depends(get_db)):
    note_access(db, user, note_id, owner=True)
    row = db.query(NoteShare).filter_by(id=share_id, note_id=note_id).first()
    if not row: raise HTTPException(404, "Share not found")
    db.delete(row); db.commit()


def feedback_payload(db, row):
    sender = db.get(User, row.user_id)
    return {"id": row.id, "subject": row.subject, "content": row.content,
            "category": row.category, "status": row.status, "reply": row.reply,
            "created_at": row.created_at.isoformat() + "Z", "sender_name": sender.username, "sender_email": sender.email}


@router.get("/api/feedback")
def feedback(user=Depends(current_user), db: Session = Depends(get_db)):
    query = db.query(Feedback)
    if user.role != "admin": query = query.filter_by(user_id=user.id)
    return [feedback_payload(db, r) for r in query.order_by(Feedback.created_at.desc()).all()]


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
    row.status = payload.status; row.reply = payload.reply; db.commit(); db.refresh(row)
    return feedback_payload(db, row)
