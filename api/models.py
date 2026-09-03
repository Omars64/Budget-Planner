from datetime import datetime
from sqlalchemy import Boolean, Column, Date, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import relationship
from .database import Base


class Wallet(Base):
    __tablename__ = "wallets"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String(100), nullable=False)
    type = Column(String(40), default="cash", nullable=False)
    initial_balance = Column(Numeric(16, 3), default=0, nullable=False)
    icon = Column(String(40), default="wallet")
    color = Column(String(20), default="#0a4173")
    archived = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.now)


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
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    type = Column(String(20), nullable=False)  # income | expense | transfer
    amount = Column(Numeric(16, 3), nullable=False)
    description = Column(String(160), nullable=False)
    notes = Column(Text, default="")
    date = Column(DateTime, nullable=False, default=datetime.now)
    wallet_id = Column(Integer, ForeignKey("wallets.id"), nullable=False)
    transfer_wallet_id = Column(Integer, ForeignKey("wallets.id"), nullable=True)
    category_id = Column(Integer, ForeignKey("categories.id"), nullable=True)
    recurring_frequency = Column(String(20), default="none")
    recurring_until = Column(Date, nullable=True)
    recurring_parent_id = Column(Integer, ForeignKey("transactions.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.now)

    wallet = relationship("Wallet", foreign_keys=[wallet_id])
    transfer_wallet = relationship("Wallet", foreign_keys=[transfer_wallet_id])
    category = relationship("Category")


class Budget(Base):
    __tablename__ = "budgets"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String(120), nullable=False)
    category_id = Column(Integer, ForeignKey("categories.id"), nullable=True)
    limit_amount = Column(Numeric(16, 3), nullable=False)
    period = Column(String(20), default="monthly")
    start_date = Column(Date, nullable=False)
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
