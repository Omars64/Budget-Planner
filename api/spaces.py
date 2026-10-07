"""Shared workspaces retain the ledger and its original wallet-level grants."""
import hashlib
import json
from contextlib import contextmanager
from types import SimpleNamespace
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import event, or_
from sqlalchemy.orm import Session, with_loader_criteria

from .database import get_db
from .models import Wallet, WalletShare, User, AppSetting, Transaction, PlannedTransaction, Category, Budget, Goal, Debt, Note, NoteFolder, Space, SpaceMember
from .auth_dependency import current_user as authenticated

PALETTE = {'green': '#267d75', 'blue': '#3158aa', 'yellow': '#aa850e', 'pink': '#aa4c79', 'lime': '#66852b', 'violet': '#7956aa'}
SCOPED = (Wallet, Category, Budget, Goal, Debt, Note, NoteFolder)


def migrate_shared_wallets(connection):
    """Only attach original wallets; never recreate financial records or broaden grants."""
    spaces, members, wallets, shares = Space.__table__, SpaceMember.__table__, Wallet.__table__, WalletShare.__table__
    all_shares = connection.execute(shares.select().order_by(shares.c.id)).mappings().all()
    grouped = {}
    for share in all_shares:
        grouped.setdefault(share['wallet_id'], []).append(share)
    groups = {}
    for wallet in connection.execute(wallets.select().where(wallets.c.space_id.is_(None))).mappings():
        grants = grouped.get(wallet['id'], [])
        if not grants:
            continue
        acl = sorted((s['invitee_email'].lower(), s['permission'], s['member_user_id']) for s in grants)
        key = hashlib.sha256(json.dumps([wallet['user_id'], acl], separators=(',', ':')).encode()).hexdigest()
        groups.setdefault(key, {'owner': wallet['user_id'], 'acl': acl, 'wallets': []})['wallets'].append(wallet['id'])
    for key, group in groups.items():
        space_id = connection.execute(spaces.select().with_only_columns(spaces.c.id).where(spaces.c.migration_key == key)).scalar()
        if space_id is None:
            currency = connection.execute(AppSetting.__table__.select().with_only_columns(AppSetting.__table__.c.value).where(AppSetting.__table__.c.user_id == group['owner'], AppSetting.__table__.c.key == 'currency')).scalar() or 'KWD'
            result = connection.execute(spaces.insert().values(owner_id=group['owner'], name='Home Expense', color='green', currency=currency, migration_key=key))
            space_id = result.inserted_primary_key[0]
            for email, role, member_id in group['acl']:
                connection.execute(members.insert().values(space_id=space_id, email=email, role=role, member_user_id=member_id))
            from .seed import EXPENSE_CATEGORIES, INCOME_CATEGORIES
            for kind, entries in [('expense', EXPENSE_CATEGORIES), ('income', INCOME_CATEGORIES)]:
                for name, icon, color in entries:
                    connection.execute(Category.__table__.insert().values(user_id=group['owner'], space_id=space_id, name=name, kind=kind, icon=icon, color=color))
        connection.execute(wallets.update().where(wallets.c.id.in_(group['wallets']), wallets.c.space_id.is_(None)).values(space_id=space_id))


def member_role(db, space, user):
    if space.owner_id == user.id:
        return 'owner'
    member = db.query(SpaceMember).filter(SpaceMember.space_id == space.id, or_(SpaceMember.member_user_id == user.id, SpaceMember.email == user.email.lower())).first()
    if not member:
        raise HTTPException(403, 'You no longer have access to this space.')
    return member.role


def establish_scope(request, db, actor):
    raw = request.query_params.get('space_id')
    if not raw:
        return None
    if db.info.get('space'):
        return db.info['space']
    if raw == 'personal':
        wallets = [row[0] for row in db.query(Wallet.id).filter(Wallet.user_id == actor.id, Wallet.space_id.is_(None))]
        context = SimpleNamespace(id=None, owner_id=actor.id, currency=None, role='owner', actor_id=actor.id, wallet_ids=wallets, category_ids=[])
        db.info['space'] = context
        return context
    try:
        space_id = int(raw)
    except ValueError:
        raise HTTPException(422, 'Invalid space')
    space = db.get(Space, space_id)
    if not space:
        raise HTTPException(404, 'Space not found')
    role = member_role(db, space, actor)
    owned = db.query(Wallet).filter_by(space_id=space.id).all()
    # Legacy clients can revoke individual wallet grants. Do not infer wider access
    # from the migration's membership snapshot when a wallet grant has changed.
    if role == 'owner':
        wallet_ids = [w.id for w in owned]
    else:
        grants = {s.wallet_id: s.permission for s in db.query(WalletShare).filter(WalletShare.wallet_id.in_([w.id for w in owned]), or_(WalletShare.member_user_id == actor.id, WalletShare.invitee_email == actor.email.lower())).all()}
        wallet_ids = list(grants)
        if len(wallet_ids) != len(owned) or any(s != role for s in grants.values()):
            raise HTTPException(409, 'Wallet permissions changed. Ask the owner to review this space membership.')
    writing = request.method not in {'GET', 'HEAD', 'OPTIONS'} and request.url.path != '/api/planner/preview'
    if writing:
        entry = request.url.path.rstrip('/') in {'/api/transactions', '/api/shared/transactions', '/api/planned-transactions'}
        if role == 'view' or (role == 'add' and (request.method != 'POST' or not entry)):
            raise HTTPException(403, 'Your space role does not allow this change.')
        if '/shares' in request.url.path:
            raise HTTPException(403, 'Manage space members in the space menu.')
        if request.url.path.startswith('/api/categories/'):
            category = db.get(Category, int(request.url.path.split('/')[3]))
            if category and category.space_id != space.id:
                raise HTTPException(403, 'This legacy category is read-only in this space.')
    legacy_categories = [row[0] for row in db.query(Transaction.category_id).filter(Transaction.wallet_id.in_(wallet_ids), Transaction.category_id.is_not(None)).distinct()]
    legacy_categories += [row[0] for row in db.query(PlannedTransaction.category_id).filter(PlannedTransaction.wallet_id.in_(wallet_ids), PlannedTransaction.category_id.is_not(None)).distinct()]
    context = SimpleNamespace(id=space.id, owner_id=space.owner_id, currency=space.currency, role=role, actor_id=actor.id, wallet_ids=wallet_ids, category_ids=legacy_categories)
    db.info['space'] = context
    return context


def workspace_user(request: Request, actor=Depends(authenticated), db: Session = Depends(get_db)):
    context = establish_scope(request, db, actor)
    try:
        # Financial ownership remains with the space owner; authentication and audit
        # identity remain with the signed-in actor. Account routes never use this dependency.
        yield SimpleNamespace(id=context.owner_id, username=actor.username, email=actor.email, role=actor.role) if context else actor
    finally:
        db.info.pop('space', None)


def workspace_actor(request: Request, actor=Depends(authenticated), db: Session = Depends(get_db)):
    establish_scope(request, db, actor)
    try:
        yield actor
    finally:
        db.info.pop('space', None)


@contextmanager
def unscoped(db):
    scope = db.info.pop('space', None)
    try:
        yield
    finally:
        if scope:
            db.info['space'] = scope


@event.listens_for(Session, 'do_orm_execute')
def scope_queries(state):
    context = state.session.info.get('space')
    if not context:
        return
    criteria = [with_loader_criteria(Wallet, Wallet.id.in_(context.wallet_ids), include_aliases=True)]
    for model in (Budget, Goal, Debt, Note, NoteFolder):
        criteria.append(with_loader_criteria(model, model.space_id == context.id, include_aliases=True))
    category_scope = or_(Category.space_id == context.id, Category.id.in_(context.category_ids)) if context.id is not None else Category.space_id.is_(None)
    criteria.append(with_loader_criteria(Category, category_scope, include_aliases=True))
    criteria.append(with_loader_criteria(Transaction, or_(Transaction.wallet_id.in_(context.wallet_ids), Transaction.transfer_wallet_id.in_(context.wallet_ids)), include_aliases=True))
    criteria.append(with_loader_criteria(PlannedTransaction, PlannedTransaction.wallet_id.in_(context.wallet_ids), include_aliases=True))
    state.statement = state.statement.options(*criteria)


@event.listens_for(Session, 'before_flush')
def scope_writes(db, *_):
    context = db.info.get('space')
    if not context:
        return
    for row in db.new:
        if isinstance(row, SCOPED):
            row.space_id = context.id
            row.user_id = context.owner_id
        if isinstance(row, Transaction) and row.recorded_by_id is None:
            row.recorded_by_id = context.actor_id
    for row in set(db.new) | set(db.dirty):
        if isinstance(row, (Transaction, PlannedTransaction)):
            if row.wallet_id not in context.wallet_ids or (row.transfer_wallet_id and row.transfer_wallet_id not in context.wallet_ids):
                raise HTTPException(400, 'Choose wallets within this space.')


def attach_wallet_members(db, wallet):
    context = db.info.get('space')
    if context and wallet.id not in context.wallet_ids:
        context.wallet_ids.append(wallet.id)
    if not wallet.space_id:
        return
    for member in db.query(SpaceMember).filter_by(space_id=wallet.space_id).all():
        account = db.query(User).filter_by(email=member.email).first()
        db.add(WalletShare(wallet_id=wallet.id, owner_id=wallet.user_id, invitee_email=member.email, member_user_id=member.member_user_id or (account.id if account else None), permission=member.role))


class SpaceIn(BaseModel):
    model_config = ConfigDict(extra='forbid')
    name: str = Field(min_length=1, max_length=80)
    color: Literal['green', 'blue', 'yellow', 'pink', 'lime', 'violet'] = 'green'
    currency: str = Field(default='KWD', pattern=r'^[A-Z]{3,8}$')

    @field_validator('name')
    @classmethod
    def clean_name(cls, value):
        if not value.strip():
            raise ValueError('Enter a space name')
        return value.strip()


class MemberIn(BaseModel):
    email: str = Field(min_length=3, max_length=160, pattern=r'^[^\s@]+@[^\s@]+\.[^\s@]+$')
    role: Literal['view', 'add', 'edit'] = 'add'

    @field_validator('email')
    @classmethod
    def normalize(cls, value):
        return value.strip().lower()


router = APIRouter(prefix='/api/spaces', tags=['Spaces'])


def serialize(db, space, actor):
    role = member_role(db, space, actor)
    owner = db.get(User, space.owner_id)
    members = db.query(SpaceMember).filter_by(space_id=space.id).order_by(SpaceMember.id).all()
    return {'id': space.id, 'name': space.name, 'color': space.color, 'accent': PALETTE[space.color], 'currency': space.currency, 'role': role, 'owner_name': owner.username, 'owner_email': owner.email, 'members': [{'email': owner.email, 'name': owner.username, 'role': 'owner'}] + [{'email': m.email, 'role': m.role} for m in members], 'migrated': bool(space.migration_key)}


@router.get('')
def list_spaces(actor=Depends(authenticated), db: Session = Depends(get_db)):
    pending = db.query(SpaceMember).filter(SpaceMember.email == actor.email.lower(), SpaceMember.member_user_id.is_(None)).all()
    for member in pending:
        member.member_user_id = actor.id
    if pending:
        db.commit()
    ids = db.query(SpaceMember.space_id).filter(or_(SpaceMember.member_user_id == actor.id, SpaceMember.email == actor.email.lower()))
    return [serialize(db, row, actor) for row in db.query(Space).filter(or_(Space.owner_id == actor.id, Space.id.in_(ids))).order_by(Space.created_at, Space.id).all()]


@router.post('', status_code=201)
def create_space(payload: SpaceIn, request: Request, actor=Depends(authenticated), db: Session = Depends(get_db)):
    from .idempotency import reserve
    receipt, previous = reserve(db, actor.id, 'space', request.headers.get('Idempotency-Key'), payload)
    if previous is not None:
        return previous
    if db.query(Space).filter_by(owner_id=actor.id).count() >= 50:
        raise HTTPException(422, 'You can own up to 50 spaces.')
    space = Space(owner_id=actor.id, **payload.model_dump())
    db.add(space); db.flush()
    from .seed import EXPENSE_CATEGORIES, INCOME_CATEGORIES
    for kind, entries in [('expense', EXPENSE_CATEGORIES), ('income', INCOME_CATEGORIES)]:
        for name, icon, color in entries:
            db.add(Category(user_id=actor.id, space_id=space.id, name=name, kind=kind, icon=icon, color=color))
    result = serialize(db, space, actor)
    if receipt:
        receipt.response = json.dumps(result)
    db.commit()
    return result


def require_owner(db, space_id, actor):
    space = db.query(Space).filter_by(id=space_id).with_for_update().first()
    if not space or space.owner_id != actor.id:
        raise HTTPException(403, 'Only the space owner can manage this space.')
    return space


@router.put('/{space_id}')
def edit_space(space_id: int, payload: SpaceIn, actor=Depends(authenticated), db: Session = Depends(get_db)):
    space = require_owner(db, space_id, actor)
    if payload.currency != space.currency and db.query(Wallet).filter_by(space_id=space.id).first():
        raise HTTPException(409, 'Currency cannot change after adding wallets. Create a separate space for another currency.')
    for key, value in payload.model_dump().items():
        setattr(space, key, value)
    db.commit()
    return serialize(db, space, actor)


@router.put('/{space_id}/members')
def set_member(space_id: int, payload: MemberIn, actor=Depends(authenticated), db: Session = Depends(get_db)):
    space = require_owner(db, space_id, actor)
    if payload.email == actor.email.lower():
        raise HTTPException(422, 'The owner already has full access.')
    if db.query(SpaceMember).filter_by(space_id=space_id).count() >= 50 and not db.query(SpaceMember).filter_by(space_id=space_id, email=payload.email).first():
        raise HTTPException(422, 'A space can have up to 50 members.')
    member = db.query(SpaceMember).filter_by(space_id=space_id, email=payload.email).first()
    if member:
        member.role = payload.role
    else:
        member = SpaceMember(space_id=space_id, **payload.model_dump())
        db.add(member)
    account = db.query(User).filter_by(email=payload.email).first()
    member.member_user_id = account.id if account else None
    for wallet in db.query(Wallet).filter_by(space_id=space_id).all():
        grant = db.query(WalletShare).filter_by(wallet_id=wallet.id, invitee_email=payload.email).first()
        if grant:
            grant.permission = payload.role
            grant.member_user_id = account.id if account else None
        else:
            db.add(WalletShare(wallet_id=wallet.id, owner_id=actor.id, invitee_email=payload.email, member_user_id=account.id if account else None, permission=payload.role))
    db.commit()
    return serialize(db, space, actor)


@router.delete('/{space_id}/members/{member_email}')
def remove_member(space_id: int, member_email: str, actor=Depends(authenticated), db: Session = Depends(get_db)):
    space = require_owner(db, space_id, actor)
    email = member_email.lower()
    db.query(SpaceMember).filter_by(space_id=space_id, email=email).delete()
    wallets = db.query(Wallet.id).filter_by(space_id=space_id)
    db.query(WalletShare).filter(WalletShare.wallet_id.in_(wallets), WalletShare.invitee_email == email).delete(synchronize_session=False)
    db.commit()
    return serialize(db, space, actor)
