from __future__ import annotations

import base64
import hashlib
import html
import os
import re
import secrets
import smtplib
import ssl
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from email.utils import format_datetime, make_msgid
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, or_
from sqlalchemy.orm import Session

from .database import Base, get_db
from .models import Category, Transaction, User, Wallet
from .schemas import TransactionIn
from .index import (
    APP_SECRET,
    current_user,
    hash_password,
    issue_token,
    materialize_recurring_for_user,
    normalize_email,
    seed_user_workspace,
    set_setting,
    setting,
    user_payload,
)

router = APIRouter()
signup_serializer = URLSafeTimedSerializer(APP_SECRET, salt="flowbudget-signup")
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
IMAGE_RE = re.compile(r"^data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/=\r\n]+)$", re.I)


class PendingSignup(Base):
    __tablename__ = "pending_signups"
    id = Column(Integer, primary_key=True)
    username = Column(String(80), nullable=False)
    email = Column(String(160), nullable=False, unique=True, index=True)
    password_hash = Column(Text, nullable=False)
    code_hash = Column(String(64), nullable=False)
    expires_at = Column(DateTime, nullable=False, index=True)
    last_sent_at = Column(DateTime, nullable=False)
    attempts = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, nullable=False, default=datetime.now)
    updated_at = Column(DateTime, nullable=False, default=datetime.now, onupdate=datetime.now)


class WalletShare(Base):
    __tablename__ = "wallet_shares"
    __table_args__ = (UniqueConstraint("wallet_id", "invitee_email", name="uq_wallet_share_email"),)
    id = Column(Integer, primary_key=True)
    wallet_id = Column(Integer, ForeignKey("wallets.id", ondelete="CASCADE"), nullable=False, index=True)
    owner_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    invitee_email = Column(String(160), nullable=False, index=True)
    member_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    permission = Column(String(12), nullable=False, default="view")
    created_at = Column(DateTime, nullable=False, default=datetime.now)


class SignupStart(BaseModel):
    username: str = Field(min_length=2, max_length=80)
    email: str = Field(min_length=5, max_length=160)
    password: str = Field(min_length=8, max_length=128)


class SignupVerify(BaseModel):
    challenge: str = Field(min_length=10, max_length=1024)
    code: str = Field(pattern=r"^\d{6}$")


class ShareIn(BaseModel):
    email: str = Field(min_length=5, max_length=160)
    permission: Literal["view", "edit"] = "view"


class AppearanceIn(BaseModel):
    profile_image: Optional[str] = None
    wallpaper_image: Optional[str] = None


class SharedTransactionIn(TransactionIn):
    @model_validator(mode="after")
    def no_recurring_shared(self):
        if self.recurring_frequency != "none" or self.recurring_until is not None:
            raise ValueError("Recurring shared transactions are not supported yet")
        return self


def now_utc() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def clean_email(value: str) -> str:
    value = normalize_email(value)
    if not EMAIL_RE.match(value):
        raise HTTPException(422, "Enter a valid email address")
    return value


def code_hash(email: str, code: str) -> str:
    return hashlib.sha256(f"{APP_SECRET}:{email}:{code}".encode()).hexdigest()


def challenge(email: str) -> str:
    return signup_serializer.dumps({"email": email})


def challenge_email(token: str) -> str:
    try:
        return clean_email(str(signup_serializer.loads(token, max_age=1800).get("email", "")))
    except SignatureExpired:
        raise HTTPException(400, "This verification session expired. Start sign up again.")
    except (BadSignature, TypeError, ValueError):
        raise HTTPException(400, "Invalid verification session. Start sign up again.")


def send_code(to_email: str, username: str, code: str) -> None:
    host = os.getenv("SMTP_HOST", "smtp.gmail.com").strip()
    port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER", "").strip()
    smtp_password = os.getenv("SMTP_PASSWORD", "").replace(" ", "")
    from_email = os.getenv("SMTP_FROM", smtp_user).strip() or smtp_user
    if not smtp_user or not smtp_password:
        raise RuntimeError("Email verification is not configured")

    safe_name = html.escape(username)
    msg = EmailMessage()
    msg["Subject"] = f"{code} is your FlowBudget verification code"
    msg["From"] = f"FlowBudget <{from_email}>"
    msg["To"] = to_email
    msg["Reply-To"] = from_email
    msg["Date"] = format_datetime(datetime.now(timezone.utc))
    msg["Message-ID"] = make_msgid(domain=from_email.split("@")[-1] if "@" in from_email else None)
    msg.set_content(f"Hi {username},\n\nYour FlowBudget verification code is {code}. It expires in 10 minutes. If you did not request it, ignore this email.\n\nFlowBudget")
    msg.add_alternative(f'''<!doctype html><html><body style="margin:0;background:#f4f8fb;font-family:Arial,sans-serif;color:#153246"><table role="presentation" width="100%"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="100%" style="max-width:520px;background:#fff;border:1px solid #dce8f0;border-radius:20px"><tr><td style="padding:28px"><div style="font-size:22px;font-weight:700;color:#0a4173">FlowBudget</div><p>Hi {safe_name},</p><p>Use this code to finish creating your account:</p><div style="font-size:34px;letter-spacing:10px;font-weight:800;color:#0a4173;padding:18px 0">{code}</div><p style="font-size:13px;color:#647987">The code expires in 10 minutes. If you did not request it, ignore this message.</p></td></tr></table></td></tr></table></body></html>''', subtype="html")
    context = ssl.create_default_context()
    if port == 465:
        with smtplib.SMTP_SSL(host, port, context=context, timeout=15) as server:
            server.login(smtp_user, smtp_password)
            server.send_message(msg)
    else:
        with smtplib.SMTP(host, port, timeout=15) as server:
            server.ehlo(); server.starttls(context=context); server.ehlo()
            server.login(smtp_user, smtp_password)
            server.send_message(msg)


def validate_image(value: Optional[str], max_bytes: int, label: str) -> str:
    if value is None or not value.strip():
        return ""
    match = IMAGE_RE.match(value.strip())
    if not match:
        raise HTTPException(422, f"{label} must be a PNG, JPEG, or WebP image")
    try:
        raw = base64.b64decode(match.group(2), validate=True)
    except Exception:
        raise HTTPException(422, f"{label} image data is invalid")
    if len(raw) > max_bytes:
        raise HTTPException(413, f"{label} is too large")
    return value.strip()


def share_for_wallet(db: Session, user: User, wallet_id: int):
    wallet = db.get(Wallet, wallet_id)
    if not wallet:
        raise HTTPException(404, "Wallet not found")
    if wallet.user_id == user.id:
        return wallet, "edit", True
    share = db.query(WalletShare).filter(WalletShare.wallet_id == wallet_id, or_(WalletShare.member_user_id == user.id, WalletShare.invitee_email == normalize_email(user.email))).first()
    if not share:
        raise HTTPException(403, "This wallet is not shared with you")
    if share.member_user_id is None:
        share.member_user_id = user.id; db.commit()
    return wallet, share.permission, False


def require_edit(db: Session, user: User, wallet_id: int) -> Wallet:
    wallet, permission, _ = share_for_wallet(db, user, wallet_id)
    if permission != "edit":
        raise HTTPException(403, "You have view-only access to this wallet")
    return wallet


def shared_wallet_ids(db: Session, user: User) -> set[int]:
    incoming = db.query(WalletShare.wallet_id).filter(or_(WalletShare.member_user_id == user.id, WalletShare.invitee_email == normalize_email(user.email))).all()
    outgoing = db.query(WalletShare.wallet_id).filter(WalletShare.owner_id == user.id).all()
    return {row[0] for row in [*incoming, *outgoing]}


def can_edit_wallet(db: Session, user: User, wallet_id: Optional[int]) -> bool:
    if not wallet_id:
        return True
    wallet = db.get(Wallet, wallet_id)
    if not wallet:
        return False
    if wallet.user_id == user.id:
        return True
    return bool(db.query(WalletShare).filter(WalletShare.wallet_id == wallet_id, WalletShare.permission == "edit", or_(WalletShare.member_user_id == user.id, WalletShare.invitee_email == normalize_email(user.email))).first())


def shared_tx_payload(db: Session, user: User, tx: Transaction, visible_ids: set[int]) -> dict:
    names = []
    if tx.wallet_id in visible_ids and tx.wallet: names.append(tx.wallet.name)
    if tx.transfer_wallet_id in visible_ids and tx.transfer_wallet: names.append(tx.transfer_wallet.name)
    owner = db.get(User, tx.user_id)
    editable = can_edit_wallet(db, user, tx.wallet_id) and (tx.type != "transfer" or can_edit_wallet(db, user, tx.transfer_wallet_id))
    return {
        "id": tx.id, "type": tx.type, "amount": float(tx.amount), "description": tx.description, "notes": tx.notes or "", "date": tx.date.isoformat(),
        "wallet_id": tx.wallet_id, "transfer_wallet_id": tx.transfer_wallet_id, "category_id": tx.category_id,
        "wallet_name": tx.wallet.name if tx.wallet_id in visible_ids and tx.wallet else "Shared wallet",
        "transfer_wallet_name": tx.transfer_wallet.name if tx.transfer_wallet_id in visible_ids and tx.transfer_wallet else ("Private wallet" if tx.transfer_wallet_id else None),
        "category_name": tx.category.name if tx.category else None, "category_color": tx.category.color if tx.category else None,
        "recurring_frequency": tx.recurring_frequency or "none", "recurring_until": tx.recurring_until.isoformat() if tx.recurring_until else None,
        "shared_wallet_names": names, "owner_email": owner.email if owner else "", "owner_name": owner.username if owner else "", "can_edit": editable,
    }


def validate_shared_tx(db: Session, user: User, payload: SharedTransactionIn, owner_id: Optional[int] = None):
    source = require_edit(db, user, payload.wallet_id)
    if owner_id is not None and source.user_id != owner_id:
        raise HTTPException(400, "A shared transaction cannot be moved to another owner's wallet")
    if payload.transfer_wallet_id:
        dest = require_edit(db, user, payload.transfer_wallet_id)
        if dest.user_id != source.user_id:
            raise HTTPException(400, "Shared transfers must stay within the same owner's wallets")
    if payload.category_id:
        category = db.query(Category).filter(Category.id == payload.category_id, Category.user_id == source.user_id).first()
        if not category: raise HTTPException(400, "Category not found for this shared wallet")
        if payload.type == "transfer": raise HTTPException(400, "Transfers cannot have a category")
        if category.kind != payload.type: raise HTTPException(400, f"{category.kind.title()} category cannot be used for {payload.type}")
    return source


@router.post("/api/auth/signup/start")
def signup_start(payload: SignupStart, db: Session = Depends(get_db)):
    email = clean_email(payload.email); username = payload.username.strip()
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(409, "An account with this email already exists. Sign in instead.")
    now = now_utc(); pending = db.query(PendingSignup).filter(PendingSignup.email == email).first(); password_hash = hash_password(payload.password)
    if pending and pending.expires_at > now and (now - pending.last_sent_at) < timedelta(seconds=45):
        pending.username = username; pending.password_hash = password_hash; pending.updated_at = now; db.commit()
        retry = max(1, 45 - int((now - pending.last_sent_at).total_seconds()))
        return {"challenge": challenge(email), "email": email, "sent": False, "message": "A verification code was already sent recently. You can use that code, or request another shortly.", "retry_after": retry}
    code = f"{secrets.randbelow(1_000_000):06d}"
    try: send_code(email, username, code)
    except Exception as exc:
        print(f"FlowBudget verification email error: {type(exc).__name__}: {exc}")
        raise HTTPException(503, "We could not send the verification email. Please try again in a moment.")
    if pending:
        pending.username = username; pending.password_hash = password_hash; pending.code_hash = code_hash(email, code); pending.expires_at = now + timedelta(minutes=10); pending.last_sent_at = now; pending.attempts = 0; pending.updated_at = now
    else:
        db.add(PendingSignup(username=username, email=email, password_hash=password_hash, code_hash=code_hash(email, code), expires_at=now + timedelta(minutes=10), last_sent_at=now, attempts=0))
    db.commit()
    return {"challenge": challenge(email), "email": email, "sent": True, "message": "We sent a 6-digit verification code to your email.", "retry_after": 45}


@router.post("/api/auth/signup/verify")
def signup_verify(payload: SignupVerify, db: Session = Depends(get_db)):
    email = challenge_email(payload.challenge); pending = db.query(PendingSignup).filter(PendingSignup.email == email).first()
    if not pending:
        if db.query(User).filter(User.email == email).first(): raise HTTPException(409, "This account has already been verified. Sign in instead.")
        raise HTTPException(400, "No pending sign up was found. Start sign up again.")
    now = now_utc()
    if pending.expires_at <= now:
        db.delete(pending); db.commit(); raise HTTPException(400, "That code expired. Start sign up again to get a new one.")
    if pending.attempts >= 6: raise HTTPException(429, "Too many incorrect attempts. Start sign up again for a new code.")
    if not secrets.compare_digest(pending.code_hash, code_hash(email, payload.code)):
        pending.attempts += 1; db.commit(); remaining = max(0, 6 - pending.attempts)
        raise HTTPException(400, f"Incorrect code. {remaining} attempt{'s' if remaining != 1 else ''} remaining.")
    if db.query(User).filter(User.email == email).first():
        db.delete(pending); db.commit(); raise HTTPException(409, "This account already exists. Sign in instead.")
    user = User(username=pending.username, email=email, password_hash=pending.password_hash, role="user", active=True)
    db.add(user); db.flush(); seed_user_workspace(db, user.id); db.delete(pending); db.commit(); db.refresh(user)
    for share in db.query(WalletShare).filter(WalletShare.invitee_email == email, WalletShare.member_user_id.is_(None)).all(): share.member_user_id = user.id
    db.commit()
    return {"token": issue_token(user), "user": user_payload(user)}


@router.get("/api/account/appearance")
def get_appearance(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return {"profile_image": setting(db, user.id, "profile_image", ""), "wallpaper_image": setting(db, user.id, "wallpaper_image", "")}


@router.put("/api/account/appearance")
def update_appearance(payload: AppearanceIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if payload.profile_image is not None: set_setting(db, user.id, "profile_image", validate_image(payload.profile_image, 1_000_000, "Profile picture"))
    if payload.wallpaper_image is not None: set_setting(db, user.id, "wallpaper_image", validate_image(payload.wallpaper_image, 2_500_000, "Wallpaper"))
    db.commit()
    return {"profile_image": setting(db, user.id, "profile_image", ""), "wallpaper_image": setting(db, user.id, "wallpaper_image", "")}


@router.get("/api/shared/wallets")
def shared_wallets(user: User = Depends(current_user), db: Session = Depends(get_db)):
    email = normalize_email(user.email)
    incoming = db.query(WalletShare).filter(or_(WalletShare.member_user_id == user.id, WalletShare.invitee_email == email)).all()
    for share in incoming:
        if share.member_user_id is None: share.member_user_id = user.id
    db.commit()
    incoming_map = {s.wallet_id: s for s in incoming}
    outgoing = db.query(WalletShare).filter(WalletShare.owner_id == user.id).all(); outgoing_map = {}
    for s in outgoing: outgoing_map.setdefault(s.wallet_id, []).append(s)
    ids = set(incoming_map) | set(outgoing_map); wallets = db.query(Wallet).filter(Wallet.id.in_(ids)).all() if ids else []
    result = []
    for wallet in wallets:
        owner = db.get(User, wallet.user_id); is_owner = wallet.user_id == user.id; incoming_share = incoming_map.get(wallet.id); shares = outgoing_map.get(wallet.id, []) if is_owner else []
        result.append({"wallet_id": wallet.id, "name": wallet.name, "type": wallet.type, "color": wallet.color, "owner_email": owner.email if owner else "", "owner_name": owner.username if owner else "", "is_owner": is_owner, "permission": "edit" if is_owner else incoming_share.permission, "can_edit": is_owner or incoming_share.permission == "edit", "shares": [{"id": s.id, "email": s.invitee_email, "permission": s.permission, "registered": bool(s.member_user_id)} for s in shares]})
    return sorted(result, key=lambda item: (not item["is_owner"], item["name"].lower()))


@router.post("/api/shared/wallets/{wallet_id}/shares", status_code=201)
def share_wallet(wallet_id: int, payload: ShareIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    wallet = db.query(Wallet).filter(Wallet.id == wallet_id, Wallet.user_id == user.id).first()
    if not wallet: raise HTTPException(404, "Wallet not found")
    email = clean_email(payload.email)
    if email == normalize_email(user.email): raise HTTPException(400, "You already own this wallet")
    member = db.query(User).filter(User.email == email, User.active.is_(True)).first()
    share = db.query(WalletShare).filter(WalletShare.wallet_id == wallet_id, WalletShare.invitee_email == email).first()
    if share:
        share.permission = payload.permission; share.member_user_id = member.id if member else None
    else:
        share = WalletShare(wallet_id=wallet.id, owner_id=user.id, invitee_email=email, member_user_id=member.id if member else None, permission=payload.permission); db.add(share)
    db.commit(); db.refresh(share)
    return {"id": share.id, "wallet_id": wallet.id, "email": email, "permission": share.permission, "registered": bool(share.member_user_id)}


@router.delete("/api/shared/shares/{share_id}", status_code=204)
def remove_share(share_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    share = db.query(WalletShare).filter(WalletShare.id == share_id, WalletShare.owner_id == user.id).first()
    if not share: raise HTTPException(404, "Share not found")
    db.delete(share); db.commit(); return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/api/shared/wallets/{wallet_id}/categories")
def shared_categories(wallet_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    wallet, _, _ = share_for_wallet(db, user, wallet_id)
    return db.query(Category).filter(Category.user_id == wallet.user_id).order_by(Category.kind, Category.name).all()


@router.get("/api/shared/transactions")
def shared_transactions(search: str = "", tx_type: str = "all", wallet_id: Optional[int] = None, limit: int = Query(300, ge=1, le=1000), user: User = Depends(current_user), db: Session = Depends(get_db)):
    ids = shared_wallet_ids(db, user)
    if not ids: return []
    if wallet_id:
        if wallet_id not in ids: raise HTTPException(403, "This wallet is not shared with you")
        ids = {wallet_id}
    for owner_id in {w.user_id for w in db.query(Wallet).filter(Wallet.id.in_(ids)).all()}: materialize_recurring_for_user(db, owner_id)
    q = db.query(Transaction).filter(or_(Transaction.wallet_id.in_(ids), Transaction.transfer_wallet_id.in_(ids)))
    if search: q = q.filter(or_(Transaction.description.ilike(f"%{search}%"), Transaction.notes.ilike(f"%{search}%")))
    if tx_type != "all":
        if tx_type not in {"income", "expense", "transfer"}: raise HTTPException(422, "Invalid transaction type")
        q = q.filter(Transaction.type == tx_type)
    return [shared_tx_payload(db, user, tx, ids) for tx in q.order_by(Transaction.date.desc(), Transaction.id.desc()).limit(limit).all()]


@router.post("/api/shared/transactions", status_code=201)
def create_shared_transaction(payload: SharedTransactionIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    source = validate_shared_tx(db, user, payload); row = Transaction(user_id=source.user_id, **payload.model_dump()); db.add(row); db.commit(); db.refresh(row)
    return shared_tx_payload(db, user, row, shared_wallet_ids(db, user))


@router.put("/api/shared/transactions/{transaction_id}")
def update_shared_transaction(transaction_id: int, payload: SharedTransactionIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = db.get(Transaction, transaction_id)
    if not row: raise HTTPException(404, "Transaction not found")
    if not can_edit_wallet(db, user, row.wallet_id) or (row.type == "transfer" and not can_edit_wallet(db, user, row.transfer_wallet_id)): raise HTTPException(403, "You do not have edit access to this transaction")
    validate_shared_tx(db, user, payload, row.user_id)
    for key, value in payload.model_dump().items(): setattr(row, key, value)
    db.commit(); db.refresh(row); return shared_tx_payload(db, user, row, shared_wallet_ids(db, user))


@router.delete("/api/shared/transactions/{transaction_id}", status_code=204)
def delete_shared_transaction(transaction_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = db.get(Transaction, transaction_id)
    if not row: raise HTTPException(404, "Transaction not found")
    if not can_edit_wallet(db, user, row.wallet_id) or (row.type == "transfer" and not can_edit_wallet(db, user, row.transfer_wallet_id)): raise HTTPException(403, "You do not have edit access to this transaction")
    db.delete(row); db.commit(); return Response(status_code=status.HTTP_204_NO_CONTENT)
