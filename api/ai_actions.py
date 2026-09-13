"""Allowlisted draft actions; proposal never executes a database mutation."""
import html
import json
import uuid
from datetime import date, datetime
from decimal import Decimal
from fastapi import HTTPException
from pydantic import ValidationError
from .models import Transaction, Budget, Goal, Debt, Note, NoteFolder, NoteRevision, NoteShare, Category
from .schemas import TransactionIn, BudgetIn, GoalIn, DebtIn
from .workspace import NoteIn
from .index import validate_transaction_references
from .ai_context import scope_wallets, access_wallet
from .account_security import audit
from .models import utc_now

MODELS = {'transaction': (Transaction, TransactionIn), 'budget': (Budget, BudgetIn),
          'goal': (Goal, GoalIn), 'debt': (Debt, DebtIn), 'note': (Note, NoteIn)}
PATHS = {'transaction': '/transactions', 'budget': '/budgets', 'goal': '/goals', 'debt': '/goals', 'note': '/notes'}


def serialize(value):
    if isinstance(value, (Decimal, date, datetime)):
        return str(value)
    raise TypeError(type(value).__name__)


def row_values(row):
    return {c.name: getattr(row, c.name) for c in row.__table__.columns}


def snapshot(row):
    return json.dumps(row_values(row) if row else {}, default=serialize, sort_keys=True)


def target(db, user, chat, kind, target_id):
    model = MODELS[kind][0]
    row = db.query(model).filter_by(id=target_id).with_for_update().first()
    if not row:
        raise HTTPException(404, 'The record no longer exists')
    if kind == 'transaction' and chat.scope == 'shared':
        if chat.wallet_id not in {row.wallet_id, row.transfer_wallet_id}:
            raise HTTPException(403, 'The transaction is outside this conversation')
        access_wallet(db, user, row.wallet_id, edit=True)
        if row.transfer_wallet_id:
            access_wallet(db, user, row.transfer_wallet_id, edit=True)
    elif row.user_id != user.id:
        raise HTTPException(403, 'This record does not belong to you')
    if kind == 'transaction' and chat.scope == 'personal' and chat.wallet_id and chat.wallet_id not in {row.wallet_id, row.transfer_wallet_id}:
        raise HTTPException(403, 'Choose the wallet containing this transaction')
    return row


def validate_data(db, user, chat, kind, operation, data, row=None):
    if kind not in MODELS or operation not in {'create', 'update', 'delete'}:
        raise HTTPException(422, 'Unsupported assistant action')
    if chat.scope != 'personal' and kind not in {'transaction', 'note'}:
        raise HTTPException(403, 'Use My wallets to change personal budgets, goals or debts')
    if chat.scope == 'general' and kind != 'note':
        raise HTTPException(403, 'Select a financial context before changing records')
    if kind == 'note' and operation != 'create' and chat.scope != 'personal':
        raise HTTPException(403, 'Use My wallets to change existing personal notes')
    if operation == 'delete':
        return {}
    schema = MODELS[kind][1]
    allowed = set(schema.model_fields)
    if kind == 'note':
        allowed = {'title', 'content', 'folder_id', 'pinned'}
    if not isinstance(data, dict) or set(data) - allowed:
        raise HTTPException(422, 'The proposal contains unsupported fields')
    initial = {k: getattr(row, k) for k in allowed if row is not None and hasattr(row, k)}
    initial.update(data)
    try:
        payload = schema.model_validate(initial)
    except ValidationError:
        raise HTTPException(422, 'The proposal is missing valid required fields; ask the assistant to correct it')
    for key in ('name', 'description', 'title'):
        if hasattr(payload, key) and not getattr(payload, key).strip():
            raise HTTPException(422, f'{key.title()} cannot be blank')
    for value in payload.model_dump().values():
        if isinstance(value, Decimal) and (not value.is_finite() or abs(value) >= Decimal('1000000000000')):
            raise HTTPException(422, 'Amount exceeds the supported range')
    if kind == 'transaction':
        if chat.scope == 'shared':
            source, _ = access_wallet(db, user, payload.wallet_id, edit=True, creating=operation == 'create')
            if chat.wallet_id not in {payload.wallet_id, payload.transfer_wallet_id}:
                raise HTTPException(403, 'The transaction must belong to the selected shared wallet')
            if row and source.user_id != row.user_id:
                raise HTTPException(403, 'A transaction cannot be moved to another owner')
            if payload.transfer_wallet_id:
                dest, _ = access_wallet(db, user, payload.transfer_wallet_id, edit=True, creating=operation == 'create')
                if dest.user_id != source.user_id:
                    raise HTTPException(422, 'Transfer wallets must have the same owner')
            validate_transaction_references(db, source.user_id, payload)
        else:
            validate_transaction_references(db, user.id, payload)
            if chat.wallet_id and chat.wallet_id not in {payload.wallet_id, payload.transfer_wallet_id}:
                raise HTTPException(403, 'Use the selected wallet for this action')
    if kind == 'budget' and payload.category_id:
        if not db.query(Category).filter_by(id=payload.category_id, user_id=user.id, kind='expense').first():
            raise HTTPException(422, 'Choose one of your expense categories')
    if kind == 'note' and payload.folder_id and not db.query(NoteFolder).filter_by(id=payload.folder_id, user_id=user.id).first():
        raise HTTPException(422, 'Choose one of your own note folders')
    if kind == 'note':
        # Assistant notes are plain text converted to inert editor HTML.
        return {k: ('<p>' + html.escape(payload.content).replace('\n', '<br>') + '</p>' if k == 'content' else getattr(payload, k)) for k in allowed}
    return payload.model_dump(mode='json')


def prepare(db, user, chat, arguments):
    kind, operation = arguments.get('kind'), arguments.get('operation')
    if kind not in MODELS or operation not in {'create', 'update', 'delete'}:
        raise HTTPException(422, 'Unsupported action')
    target_id = arguments.get('target_id')
    if operation != 'create' and (not isinstance(target_id, int) or target_id <= 0):
        raise HTTPException(422, 'A specific record is required')
    if operation == 'create' and target_id is not None:
        raise HTTPException(422, 'New records cannot specify an existing ID')
    scope_wallets(db, user, chat)
    row = target(db, user, chat, kind, target_id) if target_id else None
    try:
        changes = json.loads(arguments.get('changes_json', '{}'))
    except (ValueError, TypeError):
        raise HTTPException(422, 'Invalid action fields')
    values = validate_data(db, user, chat, kind, operation, changes, row)
    title = f"{operation.title()} {kind}: {values.get('name') or values.get('description') or values.get('title') or getattr(row, 'name', None) or getattr(row, 'description', None) or getattr(row, 'title', '')}"
    return {'id': str(uuid.uuid4()), 'kind': kind, 'operation': operation, 'target_id': target_id,
            'title': title[:160], 'payload': json.dumps(values, default=serialize), 'before': snapshot(row)}


def apply_action(db, user, chat, action):
    kind, operation = action.kind, action.operation
    row = target(db, user, chat, kind, action.target_id) if action.target_id else None
    if row and snapshot(row) != action.before:
        raise HTTPException(409, 'This record changed after the proposal. Ask for a fresh proposal before saving.')
    values = json.loads(action.payload)
    # Revalidate permissions and references at confirmation, not only at proposal time.
    if kind == 'note' and 'content' in values:
        import re
        values['content'] = html.unescape(re.sub('<[^>]*>', '', values['content'].replace('<br>', '\n')))
    values = validate_data(db, user, chat, kind, operation, values, row)
    if operation == 'create':
        owner_id = db.get(__import__('api.models', fromlist=['Wallet']).Wallet, values['wallet_id']).user_id if kind == 'transaction' else user.id
        model, schema = MODELS[kind]
        typed = schema.model_validate(values).model_dump() if kind != 'note' else values
        row = model(user_id=owner_id, **typed)
        db.add(row)
        db.flush()
    elif operation == 'update':
        if kind == 'note':
            db.add(NoteRevision(note_id=row.id, title=row.title, content=row.content, version=row.version))
            row.version += 1
            row.updated_at = utc_now()
        typed = MODELS[kind][1].model_validate(values).model_dump() if kind != 'note' else values
        for key, value in typed.items():
            setattr(row, key, value)
    else:
        from .recovery import trash
        trash(db, row, user, kind)
        if kind == 'transaction':
            db.query(Transaction).filter_by(recurring_parent_id=row.id).update({Transaction.recurring_parent_id: None}, synchronize_session=False)
        if kind == 'note':
            db.query(NoteShare).filter_by(note_id=row.id).delete(synchronize_session=False)
            db.query(NoteRevision).filter_by(note_id=row.id).delete(synchronize_session=False)
        db.delete(row)
    audit(db, row.user_id, user.id, f'AI confirmed: {operation} {kind}', f'{kind}:{row.id}')
    action.status = 'applied'
    action.result_id = row.id
    return row.id
