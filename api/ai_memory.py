"""Bounded cross-conversation context, isolated by owner and financial scope."""
from fastapi import HTTPException
from sqlalchemy import or_
from .ai_models import AIChat, AIGroup, AITurn
from .ai_context import scope_wallets


def conversation_memory(db, user, chat):
    if not getattr(chat, 'id', None):
        return {'mode': 'general', 'group_context': '', 'related_conversations': []}
    group = db.query(AIGroup).filter_by(id=chat.group_id, user_id=user.id).first() if chat.group_id else None
    query = db.query(AIChat).filter(AIChat.user_id == user.id, AIChat.id != chat.id,
                                   AIChat.scope == chat.scope, AIChat.wallet_id == chat.wallet_id,
                                   AIChat.month == chat.month)
    if group and group.memory_mode == 'group':
        query = query.filter(AIChat.group_id == group.id)
    else:
        general_ids = db.query(AIGroup.id).filter_by(user_id=user.id, memory_mode='general')
        query = query.filter(or_(AIChat.group_id.is_(None), AIChat.group_id.in_(general_ids)))
    allowed = []
    for row in query.order_by(AIChat.updated_at.desc()).limit(24).all():
        try:
            scope_wallets(db, user, row)
            allowed.append(row.id)
        except HTTPException:
            continue
    turns = db.query(AITurn).filter(AITurn.chat_id.in_(allowed), AITurn.status == 'completed').order_by(
        AITurn.created_at.desc(), AITurn.id.desc()).limit(6).all()
    return {'mode': group.memory_mode if group else 'general', 'group_context': group.context if group else '',
            'related_conversations': [{'question': turn.question[:1000], 'answer': turn.answer[:1500]} for turn in reversed(turns)]}
