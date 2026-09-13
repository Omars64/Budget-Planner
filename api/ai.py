"""Authenticated Ask Budgetly API with durable private conversations."""
import json
import uuid
from datetime import timedelta
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import or_
from .database import get_db
from .index import current_user
from .models import Note, Wallet, utc_now
from .ai_models import AIChat, AITurn
from .ai_context import scope_wallets, month_range
from .ai_service import generate, read_record
from .account_security import limit
from .ai_settings import assistant_status

router = APIRouter(prefix='/api/ai', tags=['Ask Budgetly'])
LOCAL_DAILY_LIMIT = 40
LOCAL_GLOBAL_DAILY_LIMIT = 200


class ChatIn(BaseModel):
    id: uuid.UUID
    scope: Literal['personal', 'shared', 'general'] = 'personal'
    wallet_id: int | None = Field(default=None, gt=0)
    month: str = Field(pattern=r'^\d{4}-\d{2}$')


class QuestionIn(BaseModel):
    request_id: uuid.UUID
    question: str = Field(min_length=1, max_length=8000)


class RenameIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)


class FeedbackIn(BaseModel):
    value: Literal['helpful', 'incorrect']


def chat_access(db, user, chat_id, check_scope=True):
    row = db.query(AIChat).filter_by(id=chat_id, user_id=user.id).first()
    if not row:
        raise HTTPException(404, 'Conversation not found')
    if check_scope:
        scope_wallets(db, user, row)
    return row


def turn_access(db, user, turn_id):
    turn = db.get(AITurn, turn_id)
    if not turn:
        raise HTTPException(404, 'Message not found')
    return turn, chat_access(db, user, turn.chat_id)


def chat_json(chat, accessible=True):
    return {'id': chat.id, 'title': chat.title if accessible else 'Unavailable shared conversation',
            'scope': chat.scope, 'wallet_id': chat.wallet_id, 'month': chat.month,
            'updated_at': chat.updated_at.isoformat() + 'Z', 'accessible': accessible}


def turn_json(db, turn):
    usage = json.loads(turn.usage or '{}')
    return {'id': turn.id, 'question': turn.question, 'answer': turn.answer,
            'provider': usage.get('provider', 'built-in'), 'notice': usage.get('fallback', ''),
            'sources': json.loads(turn.sources), 'suggestions': json.loads(turn.suggestions),
            'status': turn.status, 'error': turn.error, 'research': turn.research,
            'created_at': turn.created_at.isoformat() + 'Z', 'feedback': turn.feedback, 'note_id': turn.note_id,
            'actions': []}


@router.get('/config')
def config(user=Depends(current_user), db=Depends(get_db)):
    from .extensions import shared_wallets
    personal = db.query(Wallet).filter_by(user_id=user.id).order_by(Wallet.name).all()
    shared = shared_wallets(user, db)
    return {'daily_limit': LOCAL_DAILY_LIMIT, 'ai_available': assistant_status(db)['available'],
            'wallets': [{'id': w.id, 'name': w.name} for w in personal],
            'shared_wallets': [{'id': w['wallet_id'], 'name': w['name'], 'permission': w['permission']} for w in shared]}


@router.get('/chats')
def chats(offset: int = Query(0, ge=0), user=Depends(current_user), db=Depends(get_db)):
    rows = db.query(AIChat).filter_by(user_id=user.id).order_by(AIChat.updated_at.desc(), AIChat.id).offset(offset).limit(51).all()
    result = []
    for row in rows[:50]:
        try:
            scope_wallets(db, user, row)
            accessible = True
        except HTTPException:
            accessible = False
        result.append(chat_json(row, accessible))
    return {'items': result, 'has_more': len(rows) > 50}


@router.post('/chats', status_code=201)
def create_chat(payload: ChatIn, user=Depends(current_user), db=Depends(get_db)):
    month_range(payload.month)
    existing = db.get(AIChat, str(payload.id))
    if existing:
        return chat_json(chat_access(db, user, existing.id))
    if payload.scope == 'shared' and not payload.wallet_id:
        raise HTTPException(422, 'Choose a shared wallet')
    if payload.scope == 'general' and payload.wallet_id:
        raise HTTPException(422, 'General conversations cannot attach wallets')
    limit(db, f'ai-new-chat:{user.id}', 20, 3600)
    row = AIChat(id=str(payload.id), user_id=user.id, scope=payload.scope, wallet_id=payload.wallet_id, month=payload.month)
    scope_wallets(db, user, row)
    db.add(row)
    db.commit()
    return chat_json(row)


@router.get('/chats/{chat_id}')
def get_chat(chat_id: str, before: str | None = None, user=Depends(current_user), db=Depends(get_db)):
    row = chat_access(db, user, chat_id)
    if row.busy and row.busy_at < utc_now() - timedelta(minutes=3):
        db.query(AITurn).filter_by(chat_id=row.id, status='pending', run_token=row.busy).update({'status': 'failed', 'error': 'The response was interrupted. Please retry.'})
        row.busy = None
        db.commit()
    query = db.query(AITurn).filter_by(chat_id=row.id)
    if before:
        cursor = query.filter_by(id=before).first()
        if not cursor:
            raise HTTPException(422, 'Invalid message cursor')
        query = query.filter(or_(AITurn.created_at < cursor.created_at,
            (AITurn.created_at == cursor.created_at) & (AITurn.id < cursor.id)))
    turns = query.order_by(AITurn.created_at.desc(), AITurn.id.desc()).limit(41).all()
    return {**chat_json(row), 'turns': [turn_json(db, t) for t in reversed(turns[:40])], 'has_more': len(turns) > 40}


@router.patch('/chats/{chat_id}')
def rename_chat(chat_id: str, payload: RenameIn, user=Depends(current_user), db=Depends(get_db)):
    row = chat_access(db, user, chat_id)
    if not payload.title.strip():
        raise HTTPException(422, 'Enter a conversation name')
    row.title = payload.title.strip()
    db.commit()
    return chat_json(row)


@router.delete('/chats/{chat_id}', status_code=204)
def delete_chat(chat_id: str, user=Depends(current_user), db=Depends(get_db)):
    # Users can delete their chat even after wallet access is revoked.
    row = chat_access(db, user, chat_id, check_scope=False)
    db.delete(row)
    db.commit()


def run_question(db, user, chat, turn):
    limit(db, f'ai-minute:{user.id}', 6, 60)
    limit(db, f'ai-day:{user.id}', LOCAL_DAILY_LIMIT, 86400)
    limit(db, 'ai-global-day', LOCAL_GLOBAL_DAILY_LIMIT, 86400)
    token = str(uuid.uuid4())
    updated = db.query(AIChat).filter(AIChat.id == chat.id, or_(AIChat.busy.is_(None), AIChat.busy_at < utc_now() - timedelta(minutes=3))).update({
        'busy': token, 'busy_at': utc_now(), 'updated_at': utc_now()}, synchronize_session=False)
    if not updated:
        db.rollback()
        raise HTTPException(409, 'This conversation is already answering a question. Wait or stop that response.')
    if not turn.id:
        turn.id = str(uuid.uuid4())
    turn.status, turn.run_token, turn.error = 'pending', token, ''
    db.add(turn)
    if chat.title == 'New conversation':
        chat.title = turn.question[:120]
    db.commit()
    turn_id, chat_id = turn.id, chat.id
    history = db.query(AITurn).filter(AITurn.chat_id == chat_id, AITurn.status == 'completed', AITurn.id != turn_id).order_by(AITurn.created_at.desc()).limit(16).all()[::-1]
    def active():
        db.expire_all()
        return bool(db.query(AITurn.id).filter_by(id=turn_id, status='pending', run_token=token).first())
    try:
        result = generate(db, user, chat, turn.question, history, False, active)
        db.rollback()
        chat_access(db, user, chat_id)
        if not active():
            return turn_json(db, db.get(AITurn, turn_id))
        db.query(AITurn).filter_by(id=turn_id, status='pending', run_token=token).update({
            'status': 'completed', 'answer': result['answer'], 'sources': json.dumps(result['sources']),
            'suggestions': json.dumps(result['suggestions']), 'usage': json.dumps(result['usage'])}, synchronize_session=False)
    except HTTPException as error:
        db.rollback()
        db.query(AITurn).filter_by(id=turn_id, status='pending', run_token=token).update({'status': 'failed', 'error': str(error.detail)[:240]}, synchronize_session=False)
    except Exception:
        db.rollback()
        db.query(AITurn).filter_by(id=turn_id, status='pending', run_token=token).update({'status': 'failed', 'error': 'The answer could not be completed. Please retry.'}, synchronize_session=False)
    db.query(AIChat).filter_by(id=chat_id, busy=token).update({'busy': None, 'updated_at': utc_now()}, synchronize_session=False)
    db.commit()
    chat_access(db, user, chat_id)
    db.expire_all()
    return turn_json(db, db.get(AITurn, turn_id))


@router.post('/chats/{chat_id}/messages')
def ask(chat_id: str, payload: QuestionIn, user=Depends(current_user), db=Depends(get_db)):
    chat = chat_access(db, user, chat_id)
    if not payload.question.strip():
        raise HTTPException(422, 'Enter a question')
    previous = db.query(AITurn).filter_by(chat_id=chat.id, request_id=str(payload.request_id)).first()
    if previous:
        if previous.question != payload.question.strip():
            raise HTTPException(409, 'This request ID already belongs to a different question')
        return turn_json(db, previous)
    turn = AITurn(chat_id=chat.id, request_id=str(payload.request_id), question=payload.question.strip(), research=False)
    return run_question(db, user, chat, turn)


@router.post('/turns/{turn_id}/retry')
def retry(turn_id: str, user=Depends(current_user), db=Depends(get_db)):
    turn, chat = turn_access(db, user, turn_id)
    if turn.status not in {'failed', 'stopped'}:
        return turn_json(db, turn)
    return run_question(db, user, chat, turn)


@router.post('/chats/{chat_id}/stop')
def stop(chat_id: str, user=Depends(current_user), db=Depends(get_db)):
    chat = chat_access(db, user, chat_id)
    if chat.busy:
        token = chat.busy
        db.query(AITurn).filter_by(chat_id=chat.id, run_token=token, status='pending').update({'status': 'stopped'})
        db.query(AIChat).filter_by(id=chat.id, busy=token).update({'busy': None})
        db.commit()
    return {'stopped': True}


@router.post('/turns/{turn_id}/save-note')
def save_note(turn_id: str, user=Depends(current_user), db=Depends(get_db)):
    turn, chat = turn_access(db, user, turn_id)
    if turn.status != 'completed':
        raise HTTPException(422, 'Only completed answers can be saved')
    if turn.note_id:
        return {'note_id': turn.note_id}
    claimed = db.query(AITurn).filter_by(id=turn.id, note_id=None).update({'note_id': -1}, synchronize_session=False)
    if not claimed:
        db.rollback()
        db.refresh(turn)
        return {'note_id': turn.note_id}
    row = Note(user_id=user.id, title=('Ask Budgetly: ' + turn.question)[:160], content=turn.answer)
    db.add(row)
    db.flush()
    turn.note_id = row.id
    db.commit()
    return {'note_id': row.id}


@router.put('/turns/{turn_id}/feedback')
def feedback(turn_id: str, payload: FeedbackIn, user=Depends(current_user), db=Depends(get_db)):
    turn, _ = turn_access(db, user, turn_id)
    turn.feedback = payload.value
    db.commit()
    return {'feedback': payload.value}


@router.get('/chats/{chat_id}/record/{kind}/{record_id}')
def get_record(chat_id: str, kind: Literal['transaction', 'budget', 'goal', 'debt', 'note'], record_id: int,
               user=Depends(current_user), db=Depends(get_db)):
    chat = chat_access(db, user, chat_id)
    data, source = read_record(db, user, chat, kind, record_id)
    return {'data': data, 'source': source}
