from __future__ import annotations

import base64
import calendar as month_calendar
import hashlib
import hmac
import json
import os
import secrets
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import extract, func, or_
from sqlalchemy.orm import Session
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from .database import Base, SessionLocal, engine, get_db
from .models import AppSetting, Budget, Category, Debt, Goal, Transaction, User, Wallet
from .schemas import (
    BudgetIn, CategoryIn, ContributionIn, DebtIn, GoalIn, LoginPayload, PinPayload,
    SettingsPayload, TransactionIn, UserCreate, UserUpdate, WalletIn,
)
from .seed import EXPENSE_CATEGORIES, INCOME_CATEGORIES, seed_database

APP_SECRET = os.getenv("APP_SECRET", "flowbudget-dev-secret-change-me")
serializer = URLSafeTimedSerializer(APP_SECRET, salt="flowbudget-lock")
auth_serializer = URLSafeTimedSerializer(APP_SECRET, salt="flowbudget-auth")


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        seed_database(db)
    finally:
        db.close()
    yield


app = FastAPI(title="FlowBudget API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def normalize_email(email: str) -> str:
    return email.strip().lower()


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 240_000)
    return f"{base64.b64encode(salt).decode()}:{base64.b64encode(digest).decode()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        salt64, digest64 = stored.split(":", 1)
        salt = base64.b64decode(salt64)
        expected = base64.b64decode(digest64)
        actual = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 240_000)
        return hmac.compare_digest(actual, expected)
    except Exception:
        return False


def user_payload(user: User):
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "role": user.role,
        "active": user.active,
        "created_at": user.created_at.isoformat(),
    }


def issue_token(user: User) -> str:
    return auth_serializer.dumps({"user_id": user.id, "role": user.role})


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    header = request.headers.get("Authorization", "")
    token = header[7:] if header.lower().startswith("bearer ") else request.headers.get("X-App-Token")
    if not token:
        raise HTTPException(status_code=401, detail="Sign in to continue")
    try:
        data = auth_serializer.loads(token, max_age=86400)
    except (BadSignature, SignatureExpired):
        raise HTTPException(status_code=401, detail="Session expired")
    user = db.get(User, data.get("user_id"))
    if not user or not user.active:
        raise HTTPException(status_code=401, detail="Account is inactive")
    return user


def admin_user(user: User = Depends(current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


def setting(db: Session, user_id: int, key: str, default: str = "") -> str:
    row = db.get(AppSetting, {"user_id": user_id, "key": key})
    return row.value if row else default


def set_setting(db: Session, user_id: int, key: str, value: str):
    row = db.get(AppSetting, {"user_id": user_id, "key": key})
    if row:
        row.value = value
    else:
        db.add(AppSetting(user_id=user_id, key=key, value=value))


def pin_enabled(db: Session, user_id: int) -> bool:
    return bool(setting(db, user_id, "pin_hash"))


def hash_pin(pin: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", pin.encode(), salt, 180_000)
    return f"{base64.b64encode(salt).decode()}:{base64.b64encode(digest).decode()}"


def verify_pin(pin: str, stored: str) -> bool:
    try:
        salt64, digest64 = stored.split(":", 1)
        salt = base64.b64decode(salt64)
        expected = base64.b64decode(digest64)
        actual = hashlib.pbkdf2_hmac("sha256", pin.encode(), salt, 180_000)
        return hmac.compare_digest(actual, expected)
    except Exception:
        return False


def authorize(request: Request, db: Session = Depends(get_db)):
    user = current_user(request, db)
    if not pin_enabled(db, user.id):
        return user
    token = request.headers.get("X-App-Token")
    if not token:
        raise HTTPException(status_code=401, detail="App is locked")
    try:
        serializer.loads(token, max_age=86400)
    except (BadSignature, SignatureExpired):
        raise HTTPException(status_code=401, detail="Unlock session expired")
    return user




def next_occurrence(value: datetime, frequency: str) -> datetime:
    if frequency == "daily":
        return value + timedelta(days=1)
    if frequency == "weekly":
        return value + timedelta(weeks=1)
    if frequency == "monthly":
        year = value.year + (1 if value.month == 12 else 0)
        month = 1 if value.month == 12 else value.month + 1
        day = min(value.day, month_calendar.monthrange(year, month)[1])
        return value.replace(year=year, month=month, day=day)
    if frequency == "yearly":
        year = value.year + 1
        day = min(value.day, month_calendar.monthrange(year, value.month)[1])
        return value.replace(year=year, day=day)
    return value


def materialize_recurring(db: Session) -> int:
    """Create any missing due occurrences. Safe to call repeatedly."""
    now = datetime.now()
    created = 0
    templates = db.query(Transaction).filter(
        Transaction.recurring_frequency != "none",
        Transaction.recurring_parent_id.is_(None),
    ).all()
    for template in templates:
        occurrence = next_occurrence(template.date, template.recurring_frequency)
        until = template.recurring_until
        safety = 0
        while occurrence <= now and (not until or occurrence.date() <= until) and safety < 1000:
            exists = db.query(Transaction.id).filter(
                Transaction.recurring_parent_id == template.id,
                Transaction.date == occurrence,
            ).first()
            if not exists:
                db.add(Transaction(
                    type=template.type, amount=template.amount, description=template.description,
                    notes=template.notes, date=occurrence, wallet_id=template.wallet_id,
                    transfer_wallet_id=template.transfer_wallet_id, category_id=template.category_id,
                    recurring_frequency="none", recurring_until=None, recurring_parent_id=template.id,
                ))
                created += 1
            occurrence = next_occurrence(occurrence, template.recurring_frequency)
            safety += 1
    if created:
        db.commit()
    return created


def materialize_recurring_for_user(db: Session, user_id: int) -> int:
    now = datetime.now()
    created = 0
    templates = db.query(Transaction).filter(
        Transaction.user_id == user_id,
        Transaction.recurring_frequency != "none",
        Transaction.recurring_parent_id.is_(None),
    ).all()
    for template in templates:
        occurrence = next_occurrence(template.date, template.recurring_frequency)
        until = template.recurring_until
        safety = 0
        while occurrence <= now and (not until or occurrence.date() <= until) and safety < 1000:
            exists = db.query(Transaction.id).filter(
                Transaction.user_id == user_id,
                Transaction.recurring_parent_id == template.id,
                Transaction.date == occurrence,
            ).first()
            if not exists:
                db.add(Transaction(
                    user_id=user_id, type=template.type, amount=template.amount, description=template.description,
                    notes=template.notes, date=occurrence, wallet_id=template.wallet_id,
                    transfer_wallet_id=template.transfer_wallet_id, category_id=template.category_id,
                    recurring_frequency="none", recurring_until=None, recurring_parent_id=template.id,
                ))
                created += 1
            occurrence = next_occurrence(occurrence, template.recurring_frequency)
            safety += 1
    if created:
        db.commit()
    return created

def tx_payload(tx: Transaction):
    return {
        "id": tx.id, "type": tx.type, "amount": float(tx.amount), "description": tx.description,
        "notes": tx.notes or "", "date": tx.date.isoformat(), "wallet_id": tx.wallet_id,
        "transfer_wallet_id": tx.transfer_wallet_id, "category_id": tx.category_id,
        "recurring_frequency": tx.recurring_frequency or "none",
        "recurring_until": tx.recurring_until.isoformat() if tx.recurring_until else None,
        "wallet_name": tx.wallet.name if tx.wallet else "",
        "transfer_wallet_name": tx.transfer_wallet.name if tx.transfer_wallet else None,
        "category_name": tx.category.name if tx.category else None,
        "category_color": tx.category.color if tx.category else None,
    }


def wallet_balance(db: Session, wallet: Wallet) -> float:
    income = db.query(func.coalesce(func.sum(Transaction.amount), 0)).filter(Transaction.wallet_id == wallet.id, Transaction.type == "income").scalar() or 0
    expense = db.query(func.coalesce(func.sum(Transaction.amount), 0)).filter(Transaction.wallet_id == wallet.id, Transaction.type == "expense").scalar() or 0
    transfers_out = db.query(func.coalesce(func.sum(Transaction.amount), 0)).filter(Transaction.wallet_id == wallet.id, Transaction.type == "transfer").scalar() or 0
    transfers_in = db.query(func.coalesce(func.sum(Transaction.amount), 0)).filter(Transaction.transfer_wallet_id == wallet.id, Transaction.type == "transfer").scalar() or 0
    return round(float(wallet.initial_balance) + float(income) - float(expense) - float(transfers_out) + float(transfers_in), 3)


def budget_period_start(db: Session, budget: Budget, today: date) -> date:
    if budget.period == "weekly":
        week_starts_on = setting(db, budget.user_id, "week_starts_on", "sunday")
        days_since_start = today.weekday() if week_starts_on == "monday" else (today.weekday() + 1) % 7
        period_start = today - timedelta(days=days_since_start)
    elif budget.period == "yearly":
        period_start = date(today.year, 1, 1)
    else:
        period_start = date(today.year, today.month, 1)
    return max(period_start, budget.start_date)


def budget_spent(db: Session, budget: Budget) -> float:
    start = budget_period_start(db, budget, date.today())
    q = db.query(func.coalesce(func.sum(Transaction.amount), 0)).filter(
        Transaction.user_id == budget.user_id,
        Transaction.type == "expense",
        Transaction.date >= datetime.combine(start, datetime.min.time()),
    )
    if budget.category_id:
        q = q.filter(Transaction.category_id == budget.category_id)
    return round(float(q.scalar() or 0), 3)


def seed_user_workspace(db: Session, user_id: int):
    for key, value in {
        "currency": "KWD",
        "display_name": "FlowBudget",
        "week_starts_on": "sunday",
        "compact_numbers": "false",
    }.items():
        set_setting(db, user_id, key, value)
    if db.query(Wallet).filter(Wallet.user_id == user_id).count() == 0:
        db.add(Wallet(user_id=user_id, name="Main Wallet", type="cash", initial_balance=0, icon="wallet", color="#0a4173"))
    if db.query(Category).filter(Category.user_id == user_id).count() == 0:
        db.add_all([Category(user_id=user_id, name=n, kind="expense", icon=i, color=c) for n, i, c in EXPENSE_CATEGORIES])
        db.add_all([Category(user_id=user_id, name=n, kind="income", icon=i, color=c) for n, i, c in INCOME_CATEGORIES])
    db.commit()


@app.get("/api/health")
def health():
    return {"ok": True, "service": "FlowBudget", "time": datetime.now().astimezone().isoformat()}


@app.post("/api/auth/login")
def login(payload: LoginPayload, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == normalize_email(payload.email)).first()
    if not user or not user.active or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return {"token": issue_token(user), "user": user_payload(user)}


@app.get("/api/auth/me")
def me(user: User = Depends(current_user)):
    return user_payload(user)


@app.get("/api/admin/users")
def admin_users(_: User = Depends(admin_user), db: Session = Depends(get_db)):
    return [user_payload(u) for u in db.query(User).order_by(User.role, User.username).all()]


@app.post("/api/admin/users", status_code=201)
def admin_create_user(payload: UserCreate, _: User = Depends(admin_user), db: Session = Depends(get_db)):
    email = normalize_email(payload.email)
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(409, "Email is already in use")
    row = User(username=payload.username.strip(), email=email, role=payload.role, active=payload.active, password_hash=hash_password(payload.password))
    db.add(row); db.commit(); db.refresh(row)
    seed_user_workspace(db, row.id)
    return user_payload(row)


@app.put("/api/admin/users/{user_id}")
def admin_update_user(user_id: int, payload: UserUpdate, admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    row = db.get(User, user_id)
    if not row:
        raise HTTPException(404, "User not found")
    if row.id == admin.id and payload.role != "admin":
        raise HTTPException(400, "You cannot remove your own admin role")
    if row.id == admin.id and not payload.active:
        raise HTTPException(400, "You cannot deactivate your own account")
    email = normalize_email(payload.email)
    duplicate = db.query(User).filter(User.email == email, User.id != user_id).first()
    if duplicate:
        raise HTTPException(409, "Email is already in use")
    row.username = payload.username.strip()
    row.email = email
    row.role = payload.role
    row.active = payload.active
    if payload.password:
        row.password_hash = hash_password(payload.password)
    db.commit(); db.refresh(row)
    return user_payload(row)


@app.delete("/api/admin/users/{user_id}", status_code=204)
def admin_delete_user(user_id: int, admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    if user_id == admin.id:
        raise HTTPException(400, "You cannot delete your own account")
    row = db.get(User, user_id)
    if not row:
        raise HTTPException(404, "User not found")
    for model in [Transaction, Budget, Goal, Debt, Category, Wallet]:
        db.query(model).filter(model.user_id == user_id).delete()
    db.query(AppSetting).filter(AppSetting.user_id == user_id).delete()
    db.delete(row); db.commit()


@app.get("/api/security/status")
def security_status(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return {"enabled": pin_enabled(db, user.id)}


@app.post("/api/security/setup")
def security_setup(payload: PinPayload, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if pin_enabled(db, user.id):
        token = request.headers.get("X-App-Token")
        if not token:
            raise HTTPException(401, "Unlock the app before changing the PIN")
        try:
            serializer.loads(token, max_age=86400)
        except (BadSignature, SignatureExpired):
            raise HTTPException(401, "Unlock session expired")
    set_setting(db, user.id, "pin_hash", hash_pin(payload.pin))
    db.commit()
    return {"enabled": True, "token": serializer.dumps({"ok": True})}


@app.post("/api/security/unlock")
def security_unlock(payload: PinPayload, user: User = Depends(current_user), db: Session = Depends(get_db)):
    stored = setting(db, user.id, "pin_hash")
    if not stored or not verify_pin(payload.pin, stored):
        raise HTTPException(401, "Incorrect PIN")
    return {"token": serializer.dumps({"ok": True})}


@app.delete("/api/security")
def security_disable(user: User = Depends(authorize), db: Session = Depends(get_db)):
    row = db.get(AppSetting, {"user_id": user.id, "key": "pin_hash"})
    if row:
        db.delete(row)
    db.commit()
    return {"enabled": False}


@app.get("/api/settings")
def get_settings(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return {
        "currency": setting(db, user.id, "currency", "KWD"),
        "display_name": setting(db, user.id, "display_name", "FlowBudget"),
        "week_starts_on": setting(db, user.id, "week_starts_on", "sunday"),
        "compact_numbers": setting(db, user.id, "compact_numbers", "false") == "true",
    }


@app.put("/api/settings")
def update_settings(payload: SettingsPayload, user: User = Depends(current_user), db: Session = Depends(get_db)):
    for k, v in payload.model_dump().items():
        set_setting(db, user.id, k, str(v).lower() if isinstance(v, bool) else str(v))
    db.commit()
    return payload.model_dump()


@app.get("/api/wallets")
def wallets(user: User = Depends(current_user), db: Session = Depends(get_db)):
    materialize_recurring_for_user(db, user.id)
    rows = db.query(Wallet).filter(Wallet.user_id == user.id).order_by(Wallet.archived, Wallet.created_at).all()
    return [{"id": w.id, "name": w.name, "type": w.type, "initial_balance": float(w.initial_balance), "icon": w.icon, "color": w.color, "archived": w.archived, "balance": wallet_balance(db, w)} for w in rows]


@app.post("/api/wallets", status_code=201)
def create_wallet(payload: WalletIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = Wallet(user_id=user.id, **payload.model_dump())
    db.add(row); db.commit(); db.refresh(row)
    return {**payload.model_dump(), "id": row.id, "balance": wallet_balance(db, row)}


@app.put("/api/wallets/{item_id}")
def update_wallet(item_id: int, payload: WalletIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = db.query(Wallet).filter(Wallet.id == item_id, Wallet.user_id == user.id).first()
    if not row: raise HTTPException(404, "Wallet not found")
    for k, v in payload.model_dump().items(): setattr(row, k, v)
    db.commit(); db.refresh(row)
    return {**payload.model_dump(), "id": row.id, "balance": wallet_balance(db, row)}


@app.delete("/api/wallets/{item_id}", status_code=204)
def delete_wallet(item_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = db.query(Wallet).filter(Wallet.id == item_id, Wallet.user_id == user.id).first()
    if not row: raise HTTPException(404, "Wallet not found")
    used = db.query(Transaction).filter(Transaction.user_id == user.id, or_(Transaction.wallet_id == item_id, Transaction.transfer_wallet_id == item_id)).first()
    if used: raise HTTPException(409, "Wallet has transactions. Archive it instead of deleting it.")
    db.delete(row); db.commit()


@app.get("/api/categories")
def categories(kind: Optional[str] = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    q = db.query(Category).filter(Category.user_id == user.id)
    if kind: q = q.filter(Category.kind == kind)
    return q.order_by(Category.kind, Category.name).all()


@app.post("/api/categories", status_code=201)
def create_category(payload: CategoryIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = Category(user_id=user.id, **payload.model_dump()); db.add(row); db.commit(); db.refresh(row); return row


@app.delete("/api/categories/{item_id}", status_code=204)
def delete_category(item_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = db.query(Category).filter(Category.id == item_id, Category.user_id == user.id).first()
    if not row: raise HTTPException(404, "Category not found")
    if db.query(Transaction).filter(Transaction.user_id == user.id, Transaction.category_id == item_id).first(): raise HTTPException(409, "Category is in use")
    db.delete(row); db.commit()


@app.get("/api/transactions")
def transactions(
    search: str = "", tx_type: str = "all", wallet_id: Optional[int] = None,
    category_id: Optional[int] = None, date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None, limit: int = Query(200, ge=1, le=1000),
    user: User = Depends(current_user), db: Session = Depends(get_db),
):
    materialize_recurring_for_user(db, user.id)
    q = db.query(Transaction).filter(Transaction.user_id == user.id)
    if search: q = q.filter(or_(Transaction.description.ilike(f"%{search}%"), Transaction.notes.ilike(f"%{search}%")))
    if tx_type != "all": q = q.filter(Transaction.type == tx_type)
    if wallet_id: q = q.filter(or_(Transaction.wallet_id == wallet_id, Transaction.transfer_wallet_id == wallet_id))
    if category_id: q = q.filter(Transaction.category_id == category_id)
    if date_from: q = q.filter(Transaction.date >= date_from)
    if date_to: q = q.filter(Transaction.date <= date_to)
    return [tx_payload(t) for t in q.order_by(Transaction.date.desc(), Transaction.id.desc()).limit(limit).all()]


def validate_transaction_references(db: Session, user_id: int, payload: TransactionIn) -> None:
    source = db.query(Wallet).filter(Wallet.id == payload.wallet_id, Wallet.user_id == user_id).first()
    if not source:
        raise HTTPException(400, "Source wallet not found")
    if payload.transfer_wallet_id and not db.query(Wallet).filter(Wallet.id == payload.transfer_wallet_id, Wallet.user_id == user_id).first():
        raise HTTPException(400, "Destination wallet not found")
    if payload.category_id:
        category = db.query(Category).filter(Category.id == payload.category_id, Category.user_id == user_id).first()
        if not category:
            raise HTTPException(400, "Category not found")
        if payload.type == "transfer":
            raise HTTPException(400, "Transfers cannot have a category")
        if category.kind != payload.type:
            raise HTTPException(400, f"{category.kind.title()} category cannot be used for {payload.type}")


@app.post("/api/transactions", status_code=201)
def create_transaction(payload: TransactionIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    validate_transaction_references(db, user.id, payload)
    row = Transaction(user_id=user.id, **payload.model_dump()); db.add(row); db.commit(); db.refresh(row); return tx_payload(row)


@app.put("/api/transactions/{item_id}")
def update_transaction(item_id: int, payload: TransactionIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = db.query(Transaction).filter(Transaction.id == item_id, Transaction.user_id == user.id).first()
    if not row: raise HTTPException(404, "Transaction not found")
    validate_transaction_references(db, user.id, payload)
    for k, v in payload.model_dump().items(): setattr(row, k, v)
    db.commit(); db.refresh(row); return tx_payload(row)


@app.delete("/api/transactions/{item_id}", status_code=204)
def delete_transaction(item_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = db.query(Transaction).filter(Transaction.id == item_id, Transaction.user_id == user.id).first()
    if not row: raise HTTPException(404, "Transaction not found")
    db.query(Transaction).filter(Transaction.user_id == user.id, Transaction.recurring_parent_id == item_id).delete()
    db.delete(row); db.commit()


@app.get("/api/budgets")
def budgets(user: User = Depends(current_user), db: Session = Depends(get_db)):
    materialize_recurring_for_user(db, user.id)
    result = []
    for b in db.query(Budget).filter(Budget.user_id == user.id).order_by(Budget.created_at).all():
        spent = budget_spent(db, b); remaining = max(0.0, float(b.limit_amount) - spent)
        result.append({"id": b.id, "name": b.name, "category_id": b.category_id, "category_name": b.category.name if b.category else None, "limit_amount": float(b.limit_amount), "period": b.period, "start_date": b.start_date.isoformat(), "notify_threshold": b.notify_threshold, "spent": spent, "remaining": round(remaining, 3), "progress": round(min(spent / float(b.limit_amount) * 100, 999), 1)})
    return result


@app.post("/api/budgets", status_code=201)
def create_budget(payload: BudgetIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if payload.category_id and not db.query(Category).filter(Category.id == payload.category_id, Category.user_id == user.id).first():
        raise HTTPException(400, "Category not found")
    row = Budget(user_id=user.id, **payload.model_dump()); db.add(row); db.commit(); return {"id": row.id}


@app.put("/api/budgets/{item_id}")
def update_budget(item_id: int, payload: BudgetIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = db.query(Budget).filter(Budget.id == item_id, Budget.user_id == user.id).first()
    if not row: raise HTTPException(404, "Budget not found")
    if payload.category_id and not db.query(Category).filter(Category.id == payload.category_id, Category.user_id == user.id).first():
        raise HTTPException(400, "Category not found")
    for k, v in payload.model_dump().items(): setattr(row, k, v)
    db.commit(); return {"id": row.id}


@app.delete("/api/budgets/{item_id}", status_code=204)
def delete_budget(item_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = db.query(Budget).filter(Budget.id == item_id, Budget.user_id == user.id).first()
    if not row: raise HTTPException(404, "Budget not found")
    db.delete(row); db.commit()


@app.get("/api/goals")
def goals(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.query(Goal).filter(Goal.user_id == user.id).order_by(Goal.created_at).all()
    return [{"id": g.id, "name": g.name, "target_amount": float(g.target_amount), "current_amount": float(g.current_amount), "deadline": g.deadline.isoformat() if g.deadline else None, "icon": g.icon, "color": g.color, "progress": round(min(float(g.current_amount) / float(g.target_amount) * 100, 100), 1)} for g in rows]


@app.post("/api/goals", status_code=201)
def create_goal(payload: GoalIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = Goal(user_id=user.id, **payload.model_dump()); db.add(row); db.commit(); return {"id": row.id}


@app.post("/api/goals/{item_id}/contribute")
def contribute_goal(item_id: int, payload: ContributionIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = db.query(Goal).filter(Goal.id == item_id, Goal.user_id == user.id).first()
    if not row: raise HTTPException(404, "Goal not found")
    row.current_amount = min(row.target_amount, row.current_amount + payload.amount); db.commit(); return {"current_amount": float(row.current_amount)}


@app.delete("/api/goals/{item_id}", status_code=204)
def delete_goal(item_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = db.query(Goal).filter(Goal.id == item_id, Goal.user_id == user.id).first()
    if not row: raise HTTPException(404, "Goal not found")
    db.delete(row); db.commit()


@app.get("/api/debts")
def debts(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.query(Debt).filter(Debt.user_id == user.id).order_by(Debt.created_at).all()
    return [{"id": d.id, "name": d.name, "kind": d.kind, "principal": float(d.principal), "remaining": float(d.remaining), "interest_rate": float(d.interest_rate), "due_date": d.due_date.isoformat() if d.due_date else None, "minimum_payment": float(d.minimum_payment), "notes": d.notes or "", "progress": round((1 - float(d.remaining) / float(d.principal)) * 100, 1) if d.principal else 100} for d in rows]


@app.post("/api/debts", status_code=201)
def create_debt(payload: DebtIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = Debt(user_id=user.id, **payload.model_dump()); db.add(row); db.commit(); return {"id": row.id}


@app.post("/api/debts/{item_id}/pay")
def pay_debt(item_id: int, payload: ContributionIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = db.query(Debt).filter(Debt.id == item_id, Debt.user_id == user.id).first()
    if not row: raise HTTPException(404, "Debt not found")
    row.remaining = max(0, row.remaining - payload.amount); db.commit(); return {"remaining": float(row.remaining)}


@app.delete("/api/debts/{item_id}", status_code=204)
def delete_debt(item_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = db.query(Debt).filter(Debt.id == item_id, Debt.user_id == user.id).first()
    if not row: raise HTTPException(404, "Debt not found")
    db.delete(row); db.commit()


@app.get("/api/dashboard")
def dashboard(month: Optional[str] = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    materialize_recurring_for_user(db, user.id)
    try:
        current = datetime.strptime(month, "%Y-%m") if month else datetime.now()
    except ValueError:
        raise HTTPException(400, "month must be YYYY-MM")
    start = datetime(current.year, current.month, 1)
    next_month = datetime(current.year + (current.month == 12), 1 if current.month == 12 else current.month + 1, 1)
    month_txs = db.query(Transaction).filter(Transaction.user_id == user.id, Transaction.date >= start, Transaction.date < next_month).all()
    income = sum(float(t.amount) for t in month_txs if t.type == "income")
    expense = sum(float(t.amount) for t in month_txs if t.type == "expense")
    wallets_rows = db.query(Wallet).filter(Wallet.user_id == user.id, Wallet.archived == False).all()  # noqa: E712
    total_balance = sum(wallet_balance(db, w) for w in wallets_rows)
    category_map = {}
    for t in month_txs:
        if t.type == "expense":
            name = t.category.name if t.category else "Uncategorized"
            color = t.category.color if t.category else "#94a3b8"
            category_map.setdefault(name, {"name": name, "value": 0.0, "color": color})["value"] += float(t.amount)
    days = []
    days_in_month = month_calendar.monthrange(current.year, current.month)[1]
    visible_days = datetime.now().day if current.year == datetime.now().year and current.month == datetime.now().month else days_in_month
    for day in range(1, visible_days + 1):
        day_rows = [t for t in month_txs if t.date.day == day]
        days.append({"day": str(day), "income": round(sum(float(t.amount) for t in day_rows if t.type == "income"), 3), "expense": round(sum(float(t.amount) for t in day_rows if t.type == "expense"), 3)})
    recent = db.query(Transaction).filter(Transaction.user_id == user.id).order_by(Transaction.date.desc()).limit(6).all()
    bdata = []
    for b in db.query(Budget).filter(Budget.user_id == user.id).all():
        spent = budget_spent(db, b)
        bdata.append({"id": b.id, "name": b.name, "spent": spent, "limit_amount": float(b.limit_amount), "progress": round(spent / float(b.limit_amount) * 100, 1)})
    return {
        "month": current.strftime("%Y-%m"), "total_balance": round(total_balance, 3), "income": round(income, 3), "expense": round(expense, 3), "net": round(income - expense, 3),
        "cashflow": days, "category_spending": sorted(category_map.values(), key=lambda x: x["value"], reverse=True),
        "recent_transactions": [tx_payload(t) for t in recent], "budgets": bdata,
    }


@app.get("/api/analytics")
def analytics(months: int = Query(6, ge=1, le=24), user: User = Depends(current_user), db: Session = Depends(get_db)):
    materialize_recurring_for_user(db, user.id)
    now = datetime.now()
    rows = []
    for offset in range(months - 1, -1, -1):
        y = now.year; m = now.month - offset
        while m <= 0: m += 12; y -= 1
        start = datetime(y, m, 1); end = datetime(y + (m == 12), 1 if m == 12 else m + 1, 1)
        txs = db.query(Transaction).filter(Transaction.user_id == user.id, Transaction.date >= start, Transaction.date < end).all()
        rows.append({"month": start.strftime("%b"), "income": round(sum(float(t.amount) for t in txs if t.type == "income"), 3), "expense": round(sum(float(t.amount) for t in txs if t.type == "expense"), 3)})
    category_rows = db.query(Category).filter(Category.user_id == user.id, Category.kind == "expense").all()
    categories = []
    for c in category_rows:
        total = db.query(func.coalesce(func.sum(Transaction.amount), 0)).filter(Transaction.user_id == user.id, Transaction.type == "expense", Transaction.category_id == c.id).scalar() or 0
        if total: categories.append({"name": c.name, "value": round(float(total), 3), "color": c.color})
    return {"trend": rows, "categories": sorted(categories, key=lambda x: x["value"], reverse=True)}


@app.get("/api/calendar")
def calendar(year: int, month: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    materialize_recurring_for_user(db, user.id)
    if not 1 <= month <= 12: raise HTTPException(400, "Invalid month")
    start = datetime(year, month, 1); end = datetime(year + (month == 12), 1 if month == 12 else month + 1, 1)
    txs = db.query(Transaction).filter(Transaction.user_id == user.id, Transaction.date >= start, Transaction.date < end).all()
    by_day = {}
    for t in txs:
        key = t.date.date().isoformat(); by_day.setdefault(key, {"income": 0, "expense": 0, "count": 0})
        if t.type in ("income", "expense"): by_day[key][t.type] += float(t.amount)
        by_day[key]["count"] += 1
    return {k: {**v, "income": round(v["income"], 3), "expense": round(v["expense"], 3)} for k, v in by_day.items()}


@app.get("/api/backup")
def export_backup(user: User = Depends(current_user), db: Session = Depends(get_db)):
    payload = {
        "version": 1, "exported_at": datetime.now().astimezone().isoformat(),
        "wallets": [{c.name: getattr(w, c.name) for c in Wallet.__table__.columns if c.name not in {"created_at", "user_id"}} for w in db.query(Wallet).filter(Wallet.user_id == user.id).all()],
        "categories": [{c.name: getattr(x, c.name) for c in Category.__table__.columns if c.name not in {"created_at", "user_id"}} for x in db.query(Category).filter(Category.user_id == user.id).all()],
        "transactions": [{**{c.name: getattr(t, c.name) for c in Transaction.__table__.columns if c.name not in {"created_at", "user_id"}}, "date": t.date.isoformat(), "recurring_until": t.recurring_until.isoformat() if t.recurring_until else None} for t in db.query(Transaction).filter(Transaction.user_id == user.id).all()],
        "budgets": [{**{c.name: getattr(b, c.name) for c in Budget.__table__.columns if c.name not in {"created_at", "user_id"}}, "start_date": b.start_date.isoformat()} for b in db.query(Budget).filter(Budget.user_id == user.id).all()],
        "goals": [{**{c.name: getattr(g, c.name) for c in Goal.__table__.columns if c.name not in {"created_at", "user_id"}}, "deadline": g.deadline.isoformat() if g.deadline else None} for g in db.query(Goal).filter(Goal.user_id == user.id).all()],
        "debts": [{**{c.name: getattr(d, c.name) for c in Debt.__table__.columns if c.name not in {"created_at", "user_id"}}, "due_date": d.due_date.isoformat() if d.due_date else None} for d in db.query(Debt).filter(Debt.user_id == user.id).all()],
        "settings": {s.key: s.value for s in db.query(AppSetting).filter(AppSetting.user_id == user.id).all() if s.key != "pin_hash"},
    }
    return payload


@app.post("/api/backup/restore")
async def restore_backup(request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    data = await request.json()
    if data.get("version") != 1: raise HTTPException(400, "Unsupported backup version")
    # Preserve PIN while replacing budget data.
    pin_hash = setting(db, user.id, "pin_hash")
    for model in [Transaction, Budget, Goal, Debt, Category, Wallet]: db.query(model).filter(model.user_id == user.id).delete()
    for s in db.query(AppSetting).filter(AppSetting.user_id == user.id).all(): db.delete(s)
    db.flush()
    wallet_map = {}
    category_map = {}
    tx_map = {}
    for w in data.get("wallets", []):
        old_id = w.get("id")
        row = Wallet(user_id=user.id, **{k: v for k, v in w.items() if k not in {"id", "user_id"}})
        db.add(row); db.flush()
        if old_id is not None:
            wallet_map[old_id] = row.id
    for c in data.get("categories", []):
        old_id = c.get("id")
        row = Category(user_id=user.id, **{k: v for k, v in c.items() if k not in {"id", "user_id"}})
        db.add(row); db.flush()
        if old_id is not None:
            category_map[old_id] = row.id
    db.flush()
    for t in data.get("transactions", []):
        old_id = t.get("id")
        t = {k: v for k, v in dict(t).items() if k not in {"id", "user_id"}}
        t["date"] = datetime.fromisoformat(t["date"])
        t["recurring_until"] = date.fromisoformat(t["recurring_until"]) if t.get("recurring_until") else None
        t["wallet_id"] = wallet_map.get(t["wallet_id"], t["wallet_id"])
        if t.get("transfer_wallet_id"):
            t["transfer_wallet_id"] = wallet_map.get(t["transfer_wallet_id"], t["transfer_wallet_id"])
        if t.get("category_id"):
            t["category_id"] = category_map.get(t["category_id"], t["category_id"])
        t["recurring_parent_id"] = None
        row = Transaction(user_id=user.id, **t)
        db.add(row); db.flush()
        if old_id is not None:
            tx_map[old_id] = row.id
    for b in data.get("budgets", []):
        b = {k: v for k, v in dict(b).items() if k not in {"id", "user_id"}}
        b["start_date"] = date.fromisoformat(b["start_date"])
        if b.get("category_id"):
            b["category_id"] = category_map.get(b["category_id"], b["category_id"])
        db.add(Budget(user_id=user.id, **b))
    for g in data.get("goals", []):
        g = {k: v for k, v in dict(g).items() if k not in {"id", "user_id"}}
        g["deadline"] = date.fromisoformat(g["deadline"]) if g.get("deadline") else None; db.add(Goal(user_id=user.id, **g))
    for d in data.get("debts", []):
        d = {k: v for k, v in dict(d).items() if k not in {"id", "user_id"}}
        d["due_date"] = date.fromisoformat(d["due_date"]) if d.get("due_date") else None; db.add(Debt(user_id=user.id, **d))
    for k, v in data.get("settings", {}).items(): db.add(AppSetting(user_id=user.id, key=k, value=str(v)))
    if pin_hash: db.add(AppSetting(user_id=user.id, key="pin_hash", value=pin_hash))
    db.commit()
    return {"ok": True}


@app.post("/api/reset-demo")
def reset_demo(user: User = Depends(current_user), db: Session = Depends(get_db)):
    pin_hash = setting(db, user.id, "pin_hash")
    for model in [Transaction, Budget, Goal, Debt, Category, Wallet]: db.query(model).filter(model.user_id == user.id).delete()
    db.query(AppSetting).filter(AppSetting.user_id == user.id).delete()
    db.commit()
    if user.role == "admin":
        seed_database(db, include_demo=True)
    else:
        seed_user_workspace(db, user.id)
    if pin_hash: set_setting(db, user.id, "pin_hash", pin_hash); db.commit()
    return {"ok": True}


@app.exception_handler(Exception)
async def unhandled(_: Request, exc: Exception):
    # Avoid leaking internals while still returning structured JSON to the UI.
    return JSONResponse(status_code=500, content={"detail": "Unexpected server error", "type": exc.__class__.__name__})
