from datetime import datetime, timezone
from sqlalchemy import Boolean, CheckConstraint, Column, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship
from .database import Base


def utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def transaction_month_default(context):
    values = context.get_current_parameters()
    value = values.get("date") or values.get("due_at")
    if isinstance(value, datetime):
        return value.strftime("%Y-%m")
    if value:
        return str(value)[:7]
    return datetime.now().strftime("%Y-%m")


class Wallet(Base):
    __tablename__ = "wallets"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String(100), nullable=False)
    type = Column(String(40), default="cash", nullable=False)
    initial_balance = Column(Numeric(16, 3), default=0, nullable=False)
    icon = Column(String(40), default="wallet")
    color = Column(String(20), default="#0a4173")
    card_network = Column(String(12), nullable=True)
    archived = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.now)


class WalletBalanceCheck(Base):
    __tablename__ = "wallet_balance_checks"
    id = Column(Integer, primary_key=True)
    wallet_id = Column(Integer, ForeignKey("wallets.id", ondelete="CASCADE"), nullable=False, index=True)
    checked_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    checked_by_name = Column(String(80), nullable=False)
    expected_balance = Column(Numeric(16, 3), nullable=False)
    observed_balance = Column(Numeric(16, 3), nullable=False)
    currency = Column(String(8), nullable=False)
    note = Column(String(240), nullable=False, default="")
    checked_at = Column(DateTime, nullable=False, default=utc_now, index=True)


class Category(Base):
    __tablename__ = "categories"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String(100), nullable=False)
    kind = Column(String(20), nullable=False)  # income | expense
    icon = Column(String(40), default="circle")
    color = Column(String(20), default="#0a4173")
    created_at = Column(DateTime, default=datetime.now)


class Transaction(Base):
    __tablename__ = "transactions"
    __table_args__ = (
        CheckConstraint("amount > 0", name="ck_transactions_positive_amount"),
        CheckConstraint("type IN ('income', 'expense', 'transfer')", name="ck_transactions_type"),
        CheckConstraint("(type = 'transfer' AND transfer_wallet_id IS NOT NULL AND transfer_wallet_id <> wallet_id) OR (type <> 'transfer' AND transfer_wallet_id IS NULL)", name="ck_transactions_transfer_wallet"),
    )
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    type = Column(String(20), nullable=False)  # income | expense | transfer
    amount = Column(Numeric(16, 3), nullable=False)
    description = Column(String(160), nullable=False)
    notes = Column(Text, default="")
    date = Column(DateTime, nullable=False, default=datetime.now)
    reporting_month = Column(String(7), nullable=False, default=transaction_month_default)
    wallet_id = Column(Integer, ForeignKey("wallets.id"), nullable=False)
    transfer_wallet_id = Column(Integer, ForeignKey("wallets.id"), nullable=True)
    category_id = Column(Integer, ForeignKey("categories.id"), nullable=True)
    recurring_frequency = Column(String(20), default="none")
    recurring_until = Column(Date, nullable=True)
    recurring_parent_id = Column(Integer, ForeignKey("transactions.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.now)
    is_opening_balance = Column(Boolean, nullable=False, default=False, server_default='false')
    recorded_by_id = Column(Integer, nullable=True)

    wallet = relationship("Wallet", foreign_keys=[wallet_id])
    transfer_wallet = relationship("Wallet", foreign_keys=[transfer_wallet_id])
    category = relationship("Category")


class TransactionReceipt(Base):
    __tablename__ = 'transaction_receipts'
    transaction_id = Column(Integer, ForeignKey('transactions.id', ondelete='CASCADE'), primary_key=True)
    name = Column(String(180), nullable=False)
    image = Column(Text, nullable=False)
    saved_at = Column(DateTime, default=utc_now, nullable=False)


class PlannedTransaction(Base):
    __tablename__ = "planned_transactions"
    __table_args__ = (
        CheckConstraint("amount > 0", name="ck_planned_positive_amount"),
        CheckConstraint("type IN ('income', 'expense', 'transfer')", name="ck_planned_type"),
        CheckConstraint("status IN ('planned', 'scheduled', 'posted', 'failed')", name="ck_planned_status"),
    )
    id = Column(Integer, primary_key=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    wallet_id = Column(Integer, ForeignKey("wallets.id"), nullable=False, index=True)
    transfer_wallet_id = Column(Integer, ForeignKey("wallets.id"), nullable=True)
    category_id = Column(Integer, ForeignKey("categories.id"), nullable=True)
    type = Column(String(20), nullable=False)
    amount = Column(Numeric(16, 3), nullable=False)
    description = Column(String(160), nullable=False)
    notes = Column(Text, nullable=False, default="")
    due_at = Column(DateTime, nullable=False, index=True)
    reporting_month = Column(String(7), nullable=False, default=transaction_month_default)
    status = Column(String(20), nullable=False, default="planned", index=True)
    reminder_enabled = Column(Boolean, nullable=False, default=True)
    posted_transaction_id = Column(Integer, ForeignKey("transactions.id"), nullable=True, unique=True)
    error = Column(String(240), nullable=True)
    created_at = Column(DateTime, nullable=False, default=utc_now)


class Budget(Base):
    __tablename__ = "budgets"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String(120), nullable=False)
    category_id = Column(Integer, ForeignKey("categories.id"), nullable=True)
    limit_amount = Column(Numeric(16, 3), nullable=False)
    period = Column(String(20), default="monthly")
    start_date = Column(Date, nullable=False)
    reporting_month = Column(String(7), nullable=True)
    notify_threshold = Column(Integer, default=80)
    created_at = Column(DateTime, default=datetime.now)
    category = relationship("Category")


class Goal(Base):
    __tablename__ = "goals"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String(120), nullable=False)
    target_amount = Column(Numeric(16, 3), nullable=False)
    current_amount = Column(Numeric(16, 3), default=0)
    deadline = Column(Date, nullable=True)
    icon = Column(String(40), default="target")
    color = Column(String(20), default="#0a4173")
    created_at = Column(DateTime, default=datetime.now)


class Debt(Base):
    __tablename__ = "debts"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String(120), nullable=False)
    kind = Column(String(20), default="owed")  # owed | receivable
    principal = Column(Numeric(16, 3), nullable=False)
    remaining = Column(Numeric(16, 3), nullable=False)
    interest_rate = Column(Numeric(8, 3), default=0)
    due_date = Column(Date, nullable=True)
    minimum_payment = Column(Numeric(16, 3), default=0)
    notes = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.now)


class AppSetting(Base):
    __tablename__ = "settings"
    user_id = Column(Integer, ForeignKey("users.id"), primary_key=True)
    key = Column(String(80), primary_key=True)
    value = Column(Text, nullable=False)


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    username = Column(String(80), nullable=False)
    email = Column(String(160), nullable=False, unique=True, index=True)
    password_hash = Column(Text, nullable=False)
    role = Column(String(20), default="user", nullable=False)  # admin | user
    active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.now)


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
    __table_args__ = (UniqueConstraint("wallet_id", "invitee_email", name="uq_wallet_share_email"),
                      CheckConstraint("permission IN ('view', 'add', 'edit')", name="ck_wallet_shares_permission"))
    id = Column(Integer, primary_key=True)
    wallet_id = Column(Integer, ForeignKey("wallets.id", ondelete="CASCADE"), nullable=False, index=True)
    owner_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    invitee_email = Column(String(160), nullable=False, index=True)
    member_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    permission = Column(String(12), nullable=False, default="view")
    created_at = Column(DateTime, nullable=False, default=datetime.now)


class NoteFolder(Base):
    __tablename__ = "note_folders"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String(80), nullable=False)
    color = Column(String(20), nullable=False, default="#0a4173")


class Note(Base):
    __tablename__ = "notes"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    folder_id = Column(Integer, ForeignKey("note_folders.id"), nullable=True)
    title = Column(String(160), nullable=False)
    content = Column(Text, nullable=False, default="")
    pinned = Column(Boolean, nullable=False, default=False)
    note_type = Column(String(20), nullable=False, default="text")
    color = Column(String(20), nullable=False, default="#ffffff")
    page_style = Column(String(20), nullable=False, default="plain")
    checklist = Column(Text, nullable=False, default="[]")
    attachment_name = Column(String(180), nullable=True)
    attachment_type = Column(String(120), nullable=True)
    attachment_data = Column(Text, nullable=True)
    version = Column(Integer, nullable=False, default=1)
    updated_at = Column(DateTime, nullable=False, default=utc_now)


class NoteShare(Base):
    __tablename__ = "note_shares"
    __table_args__ = (UniqueConstraint("note_id", "member_id", name="uq_note_member"),)
    id = Column(Integer, primary_key=True)
    note_id = Column(Integer, ForeignKey("notes.id"), nullable=False, index=True)
    member_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    permission = Column(String(12), nullable=False, default="view")


class Feedback(Base):
    __tablename__ = "feedback"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    subject = Column(String(160), nullable=False)
    content = Column(Text, nullable=False)
    category = Column(String(20), nullable=False, default="suggestion")
    status = Column(String(20), nullable=False, default="new")
    reply = Column(Text, nullable=False, default="")
    created_at = Column(DateTime, nullable=False, default=utc_now)


class RecoveryPoint(Base):
    __tablename__ = "recovery_points"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    actor_id = Column(Integer, nullable=False)
    reason = Column(String(200), nullable=False)
    payload = Column(Text, nullable=False)
    created_at = Column(DateTime, nullable=False, default=utc_now)


class NoteRevision(Base):
    __tablename__ = "note_revisions"
    id = Column(Integer, primary_key=True)
    note_id = Column(Integer, ForeignKey("notes.id"), nullable=False, index=True)
    title = Column(String(160), nullable=False)
    content = Column(Text, nullable=False)
    version = Column(Integer, nullable=False)
    created_at = Column(DateTime, nullable=False, default=utc_now)


class RequestReceipt(Base):
    __tablename__ = 'request_receipts'
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), primary_key=True)
    scope = Column(String(40), primary_key=True)
    key = Column(String(80), primary_key=True)
    digest = Column(String(64), nullable=False)
    response = Column(Text, nullable=False, default='null')


class BankMessage(Base):
    __tablename__ = 'bank_messages'
    __table_args__ = (UniqueConstraint('user_id', 'reference', name='uq_bank_message_reference'),)
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    reference = Column(String(160), nullable=False)
    bank = Column(String(20), nullable=False)
    message = Column(Text, nullable=False)
    created_at = Column(DateTime, nullable=False, default=utc_now)
    recorded = Column(Boolean, nullable=False, default=False)


class MessageKey(Base):
    __tablename__ = 'message_keys'
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), primary_key=True)
    digest = Column(String(64), nullable=False, unique=True)
