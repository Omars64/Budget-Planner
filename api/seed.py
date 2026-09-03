import os
import base64
import hashlib
import secrets
from datetime import datetime, timedelta, date
from sqlalchemy.orm import Session
from .models import User, Wallet, Category, Transaction, Budget, Goal, Debt, AppSetting

EXPENSE_CATEGORIES = [
    ("Food & Dining", "utensils", "#0a4173"),
    ("Transport", "car", "#2f6690"),
    ("Shopping", "shopping-bag", "#4f87a8"),
    ("Home", "house", "#22577a"),
    ("Entertainment", "gamepad", "#3b7197"),
    ("Health", "heart-pulse", "#517fa4"),
    ("Bills", "receipt", "#184f78"),
    ("Travel", "plane", "#6793b1"),
]
INCOME_CATEGORIES = [
    ("Salary", "briefcase", "#0a4173"),
    ("Freelance", "laptop", "#2f6690"),
    ("Gift", "gift", "#517fa4"),
    ("Other Income", "circle-dollar-sign", "#6793b1"),
]


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 240_000)
    return f"{base64.b64encode(salt).decode()}:{base64.b64encode(digest).decode()}"


def ensure_admin_user(db: Session) -> User:
    email = os.getenv("ADMIN_INITIAL_EMAIL", "omarsolanki46@gmail.com").strip().lower()
    username = os.getenv("ADMIN_INITIAL_USERNAME", "Omar").strip() or "Omar"
    password = os.getenv("ADMIN_INITIAL_PASSWORD") or secrets.token_urlsafe(24)
    admin = db.query(User).filter(User.email == email).first()
    if admin:
        admin.username = username
        admin.role = "admin"
        admin.active = True
        return admin
    admin = User(username=username, email=email, role="admin", active=True, password_hash=hash_password(password))
    db.add(admin)
    db.flush()
    return admin


def add_default_settings(db: Session, user_id: int):
    for key, value in {
        "currency": "KWD",
        "display_name": "FlowBudget",
        "week_starts_on": "sunday",
        "compact_numbers": "false",
    }.items():
        if not db.get(AppSetting, {"user_id": user_id, "key": key}):
            db.add(AppSetting(user_id=user_id, key=key, value=value))


def seed_database(db: Session, include_demo: bool = True):
    admin = ensure_admin_user(db)
    add_default_settings(db, admin.id)
    db.flush()

    if db.query(Wallet).filter(Wallet.user_id == admin.id).count() > 0:
        db.commit()
        return

    wallets = [
        Wallet(user_id=admin.id, name="Main Wallet", type="cash", initial_balance=320.0, icon="wallet", color="#0a4173"),
        Wallet(user_id=admin.id, name="Bank Account", type="bank", initial_balance=1850.0, icon="landmark", color="#2f6690"),
        Wallet(user_id=admin.id, name="Travel Card", type="card", initial_balance=210.0, icon="credit-card", color="#517fa4"),
    ]
    db.add_all(wallets)
    categories = [Category(user_id=admin.id, name=n, kind="expense", icon=i, color=c) for n, i, c in EXPENSE_CATEGORIES]
    categories += [Category(user_id=admin.id, name=n, kind="income", icon=i, color=c) for n, i, c in INCOME_CATEGORIES]
    db.add_all(categories)
    db.flush()

    if include_demo:
        cat = {c.name: c for c in categories}
        now = datetime.now().replace(second=0, microsecond=0)
        demo = [
            Transaction(user_id=admin.id, type="income", amount=1450, description="Monthly salary", date=now - timedelta(days=18), wallet_id=wallets[1].id, category_id=cat["Salary"].id, recurring_frequency="monthly"),
            Transaction(user_id=admin.id, type="expense", amount=32.4, description="Groceries", date=now - timedelta(days=2), wallet_id=wallets[1].id, category_id=cat["Food & Dining"].id),
            Transaction(user_id=admin.id, type="expense", amount=11.2, description="Coffee with friends", date=now - timedelta(days=1, hours=3), wallet_id=wallets[0].id, category_id=cat["Food & Dining"].id),
            Transaction(user_id=admin.id, type="expense", amount=18.0, description="Fuel", date=now - timedelta(days=4), wallet_id=wallets[1].id, category_id=cat["Transport"].id),
            Transaction(user_id=admin.id, type="expense", amount=46.5, description="Internet & mobile", date=now - timedelta(days=6), wallet_id=wallets[1].id, category_id=cat["Bills"].id, recurring_frequency="monthly"),
            Transaction(user_id=admin.id, type="expense", amount=23.75, description="Game purchase", date=now - timedelta(days=9), wallet_id=wallets[2].id, category_id=cat["Entertainment"].id),
            Transaction(user_id=admin.id, type="income", amount=180, description="Freelance automation", date=now - timedelta(days=7), wallet_id=wallets[1].id, category_id=cat["Freelance"].id),
            Transaction(user_id=admin.id, type="transfer", amount=100, description="Travel top-up", date=now - timedelta(days=5), wallet_id=wallets[1].id, transfer_wallet_id=wallets[2].id),
        ]
        db.add_all(demo)
        db.add(Budget(user_id=admin.id, name="Food this month", category_id=cat["Food & Dining"].id, limit_amount=180, period="monthly", start_date=date.today().replace(day=1), notify_threshold=80))
        db.add(Budget(user_id=admin.id, name="Transport", category_id=cat["Transport"].id, limit_amount=100, period="monthly", start_date=date.today().replace(day=1), notify_threshold=80))
        db.add(Goal(user_id=admin.id, name="Japan trip", target_amount=1200, current_amount=420, deadline=date.today() + timedelta(days=210), icon="plane", color="#0a4173"))
        db.add(Goal(user_id=admin.id, name="Emergency cushion", target_amount=2000, current_amount=760, deadline=date.today() + timedelta(days=365), icon="shield-check", color="#2f6690"))
        db.add(Debt(user_id=admin.id, name="Laptop installment", kind="owed", principal=600, remaining=285, interest_rate=0, due_date=date.today() + timedelta(days=95), minimum_payment=50, notes="0% installment plan"))

    db.commit()
