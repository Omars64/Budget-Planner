"""Transaction-scoped owner claims and consistent ledger snapshots.

Claim owners in ascending order before resource locks and authorization reads.
Claims survive flush/savepoints, but never commit or rollback. Late ORM writers
use NOWAIT so an older resource lock cannot deadlock destructive operations.
"""
from contextlib import contextmanager

from fastapi import HTTPException
from sqlalchemy import create_engine, event, inspect, or_, select, update
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session
from sqlalchemy.pool import NullPool

from .models import (User, Wallet, Transaction, PlannedTransaction, Category,
                     Budget, Goal, Debt, Note, NoteFolder, AppSetting, Space,
                     SpaceMember, WalletShare, TransactionReceipt,
                     WalletBalanceCheck, NoteRevision, NoteShare)


DIRECT = {model.__table__.name: (model.__table__, column) for model, column in (
    (Wallet, 'user_id'), (Transaction, 'user_id'), (PlannedTransaction, 'owner_id'),
    (Category, 'user_id'), (Budget, 'user_id'), (Goal, 'user_id'), (Debt, 'user_id'),
    (Note, 'user_id'), (NoteFolder, 'user_id'), (AppSetting, 'user_id'),
    (Space, 'owner_id'), (WalletShare, 'owner_id'))}
INDIRECT = {model.__table__.name: (model.__table__, reference, parent.__table__, owner)
            for model, reference, parent, owner in (
                (SpaceMember, 'space_id', Space, 'owner_id'),
                (TransactionReceipt, 'transaction_id', Transaction, 'user_id'),
                (WalletBalanceCheck, 'wallet_id', Wallet, 'user_id'),
                (NoteRevision, 'note_id', Note, 'user_id'),
                (NoteShare, 'note_id', Note, 'user_id'))}


def _claims(db):
    transaction = db.get_transaction()
    previous, owners = db.info.get('owner_claims', (None, set()))
    if previous is not transaction:
        owners = set()
        db.info['owner_claims'] = (transaction, owners)
    return owners


@event.listens_for(Session, 'after_soft_rollback')
def forget_rolled_back_claims(db, previous):
    # PostgreSQL releases claims acquired after a rolled-back savepoint.
    db.info.pop('owner_claims', None)
    db.info.pop('scope_authorized_transaction', None)


def lock_owners(db, *owner_ids, nowait=False):
    """No-op-update existing User rows; caller owns commit/rollback and ordering."""
    connection = db.connection()
    if connection.dialect.name == 'sqlite' and not connection.connection.driver_connection.in_transaction:
        connection.exec_driver_sql('BEGIN IMMEDIATE')
    held = _claims(db)
    missing = sorted({ident for ident in owner_ids if ident is not None} - held)
    if held and missing and missing[0] < max(held):
        nowait = True
    try:
        for ident in missing:
            if connection.dialect.name == 'postgresql':
                found = connection.execute(select(User.id).where(User.id == ident)
                    .with_for_update(key_share=True, nowait=nowait)).scalar_one_or_none()
                if found is None:
                    raise HTTPException(409, 'Workspace changed. Refresh and try again.')
            result = connection.execute(update(User.__table__).where(User.id == ident)
                                        .values(active=User.active))
            if result.rowcount != 1:
                raise HTTPException(409, 'Workspace changed. Refresh and try again.')
            held.add(ident)
    except OperationalError as error:
        if getattr(error.orig, 'sqlstate', None) == '55P03':
            raise HTTPException(409, 'Workspace is changing. Retry this request.') from None
        raise


def lock_wallet_owners(db, *wallet_ids, extra_owners=()):
    ids = sorted({ident for ident in wallet_ids if ident is not None})
    rows = db.query(Wallet.id, Wallet.user_id).filter(Wallet.id.in_(ids)).all()
    lock_owners(db, *extra_owners, *(row.user_id for row in rows))
    current = db.query(Wallet).filter(Wallet.id.in_(ids)).populate_existing().all()
    if {(row.id, row.user_id) for row in current} != set(rows):
        raise HTTPException(409, 'Wallet ownership changed. Refresh and try again.')
    return current


def lock_record(db, model, ident, wallet_ids=()):
    owner_column = model.user_id if model is Transaction else model.owner_id
    original = db.query(owner_column, model.wallet_id, model.transfer_wallet_id).filter(model.id == ident).first()
    if original is None:
        raise HTTPException(404, 'Transaction or planned entry not found')
    lock_wallet_owners(db, original.wallet_id, original.transfer_wallet_id, *wallet_ids,
                       extra_owners=(original[0],))
    row = db.query(model).filter(model.id == ident).populate_existing().with_for_update().first()
    if row is None:
        raise HTTPException(404, 'Transaction or planned entry not found')
    if (getattr(row, owner_column.key), row.wallet_id, row.transfer_wallet_id) != tuple(original):
        raise HTTPException(409, 'Transaction ownership changed. Refresh and try again.')
    return row


@contextmanager
def snapshot_session(db, owner_id):
    """Recovery uses its held claim; standalone PostgreSQL exports use MVCC."""
    if owner_id in _claims(db):
        # A separate identity map avoids exporting objects loaded before the claim.
        with Session(bind=db.connection(), autoflush=False, join_transaction_mode='rollback_only') as snapshot:
            yield snapshot
        return
    bind = db.get_bind()
    if bind.dialect.name == 'postgresql':
        engine = getattr(bind, 'engine', bind)
        # Never borrow a second slot from a pool whose first slot the caller holds.
        snapshot_engine = create_engine(engine.url, poolclass=NullPool,
                                        connect_args={'connect_timeout': 2})
        try:
            with snapshot_engine.connect().execution_options(isolation_level='REPEATABLE READ') as connection:
                with connection.begin():
                    connection.exec_driver_sql('SET TRANSACTION READ ONLY')
                    connection.exec_driver_sql("SET LOCAL statement_timeout = '10s'")
                    with Session(bind=connection, autoflush=False) as snapshot:
                        yield snapshot
        finally:
            snapshot_engine.dispose()
    else:
        connection = db.connection()
        if not connection.connection.driver_connection.in_transaction:
            connection.exec_driver_sql('BEGIN')
        yield db


def remember_wallet_access(db, actor, wallet, permission):
    db.info.setdefault('wallet_access', {})[(actor.id, wallet.id)] = (
        wallet.user_id, actor.email.lower(), permission)


def _refresh_access(db, owners):
    scoped_request = db.info.get('scope_request')
    if scoped_request and db.info.get('scope_authorized_transaction') is not db.get_transaction():
        from .spaces import establish_scope
        request, actor = scoped_request
        db.info.pop('space', None)
        establish_scope(request, db, actor)
        db.info['scope_authorized_transaction'] = db.get_transaction()
    connection = db.connection()
    for (actor_id, wallet_id), (owner_id, email, permission) in db.info.get('wallet_access', {}).items():
        if owner_id not in owners:
            continue
        current_owner = connection.execute(select(Wallet.user_id).where(Wallet.id == wallet_id)).scalar_one_or_none()
        if current_owner != owner_id:
            raise HTTPException(409, 'Wallet changed. Refresh and try again.')
        if actor_id == owner_id:
            continue
        space_id = connection.execute(select(Wallet.space_id).where(Wallet.id == wallet_id)).scalar_one_or_none()
        if space_id is not None:
            current = connection.execute(select(SpaceMember.role).where(
                SpaceMember.space_id == space_id,
                or_(SpaceMember.member_user_id == actor_id, SpaceMember.email == email))).scalar_one_or_none()
            current = 'edit' if current == 'add' else current
            if current != permission:
                raise HTTPException(403, 'Space permissions changed. Refresh and try again.')
            continue
        current = connection.execute(select(WalletShare.permission).where(
            WalletShare.wallet_id == wallet_id,
            or_(WalletShare.member_user_id == actor_id, WalletShare.invitee_email == email)).limit(1)).scalar_one_or_none()
        if current != permission:
            raise HTTPException(403, 'Wallet permissions changed. Refresh and try again.')


def _owners_for_rows(connection, table, condition=None):
    if table.name in DIRECT:
        actual, column = DIRECT[table.name]
        query = select(actual.c[column])
    elif table.name in INDIRECT:
        actual, reference, parent, owner = INDIRECT[table.name]
        query = select(parent.c[owner]).select_from(actual.join(parent, actual.c[reference] == parent.c.id))
    else:
        return set()
    if condition is not None:
        query = query.where(condition)
    return set(connection.execute(query.distinct()).scalars())


@event.listens_for(Session, 'before_flush')
def claim_financial_flush(db, *_):
    owners = set()
    connection = db.connection()
    references = {}
    for row in set(db.new) | set(db.dirty) | set(db.deleted):
        table = row.__table__
        state = inspect(row)
        if table.name in DIRECT:
            column = DIRECT[table.name][1]
            owners.add(getattr(row, column))
            history = state.attrs[column].history
            owners.update(history.deleted)
            if state.identity and history.has_changes() and not history.deleted:
                condition = None
                for key, value in zip(table.primary_key.columns, state.identity):
                    term = key == value
                    condition = term if condition is None else condition & term
                owners.update(_owners_for_rows(connection, table, condition))
        elif table.name in INDIRECT:
            _, reference, parent, owner = INDIRECT[table.name]
            value = getattr(row, reference)
            values = references.setdefault((parent.name, owner), (parent, set()))[1]
            values.add(value)
            history = state.attrs[reference].history
            values.update(history.deleted)
            if state.identity and history.has_changes() and not history.deleted:
                condition = None
                for key, original in zip(table.primary_key.columns, state.identity):
                    term = key == original
                    condition = term if condition is None else condition & term
                owners.update(_owners_for_rows(connection, table, condition))
        else:
            continue
    for (_, owner), (parent, values) in references.items():
        owners.update(connection.execute(select(parent.c[owner]).where(parent.c.id.in_(values)).distinct()).scalars())
    if owners - {None}:
        lock_owners(db, *owners, nowait=True)
        _refresh_access(db, owners)


@event.listens_for(Session, 'do_orm_execute')
def claim_financial_bulk(state):
    if not (state.is_update or state.is_delete):
        return
    table = state.statement.table
    if table.name not in DIRECT and table.name not in INDIRECT:
        return
    owners = _owners_for_rows(state.session.connection(), table, state.statement.whereclause)
    if owners:
        lock_owners(state.session, *owners, nowait=True)
        _refresh_access(state.session, owners)
