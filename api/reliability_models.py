from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Boolean
from .database import Base
from .models import utc_now


class AccountSession(Base):
    __tablename__ = 'account_sessions'
    id = Column(String(64), primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), index=True, nullable=False)
    label = Column(String(200), default='Browser session', nullable=False)
    created_at = Column(DateTime, default=utc_now, nullable=False)
    last_seen = Column(DateTime, default=utc_now, nullable=False)
    verified_at = Column(DateTime, nullable=True)
    revoked = Column(Boolean, default=False, nullable=False)


class Activity(Base):
    __tablename__ = 'account_activity'
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), index=True, nullable=False)
    actor_id = Column(Integer, nullable=False)
    action = Column(String(160), nullable=False)
    resource = Column(String(80), nullable=False, default='account')
    created_at = Column(DateTime, default=utc_now, nullable=False)


class RateBucket(Base):
    __tablename__ = 'request_limits'
    key = Column(String(64), primary_key=True)
    started = Column(DateTime, default=utc_now, nullable=False)
    count = Column(Integer, default=0, nullable=False)


class ResetToken(Base):
    __tablename__ = 'password_resets'
    digest = Column(String(64), primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    expires = Column(DateTime, nullable=False)


class TrashItem(Base):
    __tablename__ = 'trash_items'
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    kind = Column(String(30), nullable=False)
    label = Column(String(200), nullable=False)
    payload = Column(Text, nullable=False)
    created_at = Column(DateTime, default=utc_now, nullable=False)
    restored_at = Column(DateTime, nullable=True)


class ServiceEvent(Base):
    __tablename__ = 'service_events'
    id = Column(Integer, primary_key=True)
    area = Column(String(100), nullable=False)
    status = Column(Integer, nullable=False)
    duration_ms = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=utc_now, nullable=False)


class TransactionTemplate(Base):
    __tablename__ = 'transaction_templates'
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    name = Column(String(100), nullable=False)
    payload = Column(Text, nullable=False)
