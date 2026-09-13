"""Private conversations and durable, explicitly confirmed assistant actions."""
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from .database import Base
from .models import utc_now


class AIChat(Base):
    __tablename__ = 'ai_chats'
    id = Column(String(36), primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    title = Column(String(120), nullable=False, default='New conversation')
    scope = Column(String(16), nullable=False, default='personal')
    wallet_id = Column(Integer, nullable=True)
    month = Column(String(7), nullable=False)
    busy = Column(String(36), nullable=True)
    busy_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=utc_now)
    updated_at = Column(DateTime, nullable=False, default=utc_now)


class AITurn(Base):
    __tablename__ = 'ai_turns'
    __table_args__ = (UniqueConstraint('chat_id', 'request_id', name='uq_ai_turn_request'),)
    id = Column(String(36), primary_key=True)
    chat_id = Column(String(36), ForeignKey('ai_chats.id', ondelete='CASCADE'), nullable=False, index=True)
    request_id = Column(String(36), nullable=False)
    question = Column(Text, nullable=False)
    answer = Column(Text, nullable=False, default='')
    sources = Column(Text, nullable=False, default='[]')
    suggestions = Column(Text, nullable=False, default='[]')
    research = Column(Boolean, nullable=False, default=False)
    status = Column(String(16), nullable=False, default='pending')
    error = Column(String(240), nullable=False, default='')
    run_token = Column(String(36), nullable=False)
    feedback = Column(String(16), nullable=True)
    note_id = Column(Integer, nullable=True)
    usage = Column(Text, nullable=False, default='{}')
    created_at = Column(DateTime, nullable=False, default=utc_now)


class AIAction(Base):
    __tablename__ = 'ai_actions'
    id = Column(String(36), primary_key=True)
    turn_id = Column(String(36), ForeignKey('ai_turns.id', ondelete='CASCADE'), nullable=False, index=True)
    kind = Column(String(16), nullable=False)
    operation = Column(String(12), nullable=False)
    target_id = Column(Integer, nullable=True)
    title = Column(String(160), nullable=False)
    payload = Column(Text, nullable=False)
    before = Column(Text, nullable=False, default='{}')
    status = Column(String(16), nullable=False, default='pending')
    result_id = Column(Integer, nullable=True)
    created_at = Column(DateTime, nullable=False, default=utc_now)
