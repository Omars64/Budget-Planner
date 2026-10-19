"""Opt-in barrier races in an owned local PostgreSQL schema.

Run: python tests/test_financial_coordination.py --url
postgresql+psycopg://postgres@127.0.0.1:55432/budgetly_verification_security
Ordinary pytest collection skips these tests and never connects to a database.
"""
import argparse
import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
import json
import hashlib
import logging
from collections import Counter
import os
from pathlib import Path
import sys
import secrets
import threading
import time
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session
from starlette.requests import Request

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
from scripts import verify_postgres as harness

pytestmark = pytest.mark.skipif(os.getenv('BUDGETLY_SECURITY_RACE_RUN') != '1',
                              reason='requires explicitly isolated local PostgreSQL runner')


def request(path, method='PUT', headers=None, body=None):
    route, _, query = path.partition('?')
    async def receive():
        return {'type': 'http.request', 'body': body or b'', 'more_body': False}
    return Request({'type': 'http', 'method': method, 'path': route,
                    'query_string': query.encode(), 'headers':
                    [(key.lower().encode(), value.encode()) for key, value in (headers or {}).items()],
                    'scheme': 'http', 'server': ('test', 80)}, receive=receive)


def wait(signal):
    assert signal.wait(5), 'worker did not reach barrier'


def blocked(engine, pid, blocker):
    end = time.monotonic() + 5
    with engine.connect() as connection:
        while time.monotonic() < end:
            if blocker in connection.scalar(text('SELECT pg_blocking_pids(:pid)'), {'pid': pid}):
                return
            threading.Event().wait(.01)
    pytest.fail('expected owner claim did not block')


@pytest.fixture(scope='module')
def api():
    from api import app, coordination, data_safety, extensions, index, planned, receipts, spaces
    from api import google_auth, google_drive, models, schemas
    from api.database import Base, engine
    assert engine.dialect.name == 'postgresql', 'runner must retain its isolated PostgreSQL connection'
    Base.metadata.create_all(engine)
    yield SimpleNamespace(engine=engine, c=coordination, safety=data_safety, ext=extensions,
                          index=index, planned=planned, receipts=receipts, spaces=spaces,
                          auth=google_auth, drive=google_drive, m=models, schemas=schemas)
    engine.dispose()


@pytest.fixture
def ledger(api):
    m = api.m
    with Session(api.engine, autoflush=False) as db:
        suffix = secrets.token_hex(8)
        owner = m.User(username='Owner', email=f'owner-{suffix}@test.invalid', password_hash='unused')
        member = m.User(username='Member', email=f'member-{suffix}@test.invalid', password_hash='unused')
        db.add_all([owner, member]); db.flush()
        space = m.Space(owner_id=owner.id, name='Synthetic', currency='KWD')
        db.add(space); db.flush()
        wallet = m.Wallet(user_id=owner.id, space_id=space.id, name='Synthetic', initial_balance=0)
        db.add(wallet); db.flush()
        tx = m.Transaction(user_id=owner.id, wallet_id=wallet.id, type='expense', amount=1,
                           description='Synthetic', date=api.index.ledger_now(), recurring_frequency='none')
        db.add_all([tx, m.SpaceMember(space_id=space.id, email=member.email,
                                    member_user_id=member.id, role='edit'),
                    m.WalletShare(owner_id=owner.id, wallet_id=wallet.id, invitee_email=member.email,
                                  member_user_id=member.id, permission='edit')])
        db.flush()
        ids = SimpleNamespace(owner=owner.id, member=member.id, email=member.email,
                              space=space.id, wallet=wallet.id, tx=tx.id)
        db.commit()
        return ids


def transaction(api, wallet, description='New'):
    return api.schemas.TransactionWriteIn(wallet_id=wallet, type='expense', amount=1,
        description=description, date=api.index.ledger_now(), recurring_frequency='none')


def test_receipt_reauthorizes_after_limiter_commit(api, ledger, monkeypatch):
    import base64
    import io
    from PIL import Image
    from fastapi import HTTPException
    image = io.BytesIO(); Image.new('RGB', (1, 1)).save(image, format='PNG')
    payload = api.schemas.ReceiptIn(name='synthetic.png', image='data:image/png;base64,' +
                                   base64.b64encode(image.getvalue()).decode())
    committed, resume = threading.Event(), threading.Event()
    original = api.receipts.limit
    def limiter(*args):
        original(*args)
        committed.set(); wait(resume)
    monkeypatch.setattr(api.receipts, 'limit', limiter)
    def upload():
        with Session(api.engine, autoflush=False) as db:
            actor = db.get(api.m.User, ledger.owner)
            try:
                api.receipts.save_receipt(ledger.tx, payload, request(f'/api/transactions/{ledger.tx}/receipt'), actor, db)
            except HTTPException as error:
                return error.status_code
            return 200
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(upload)
        try:
            wait(committed)
            with Session(api.engine, autoflush=False) as db:
                api.c.lock_owners(db, ledger.owner, ledger.member)
                target = api.m.Wallet(user_id=ledger.member, name='New owner', initial_balance=0)
                db.add(target); db.flush()
                db.add(api.m.WalletShare(owner_id=ledger.member, wallet_id=target.id,
                    invitee_email=db.get(api.m.User, ledger.owner).email,
                    member_user_id=ledger.owner, permission='edit')); db.flush()
                row = db.get(api.m.Transaction, ledger.tx)
                revision = api.index.transaction_revision(row)
                body = api.ext.SharedTransactionIn(**transaction(api, target.id).model_dump(exclude={'receipt'}))
                api.ext.update_shared_transaction(ledger.tx, body,
                    request(f'/api/shared/transactions/{ledger.tx}', headers={'If-Match': revision}),
                    db.get(api.m.User, ledger.owner), db)
        finally:
            resume.set()
        assert future.result(timeout=5) == 404
    with Session(api.engine) as db:
        assert db.get(api.m.Transaction, ledger.tx).user_id == ledger.member
        assert db.get(api.m.TransactionReceipt, ledger.tx) is None


@pytest.mark.parametrize('change', ['remove', 'downgrade', 'legacy'])
def test_scope_reads_permissions_after_owner_claim(api, ledger, change):
    from fastapi import HTTPException
    started = threading.Event(); pid = []
    def write():
        with Session(api.engine, autoflush=False) as db:
            actor = db.get(api.m.User, ledger.member)
            pid.append(db.scalar(text('SELECT pg_backend_pid()'))); started.set()
            try:
                api.spaces.establish_scope(request(f'/api/transactions/{ledger.tx}?space_id={ledger.space}'), db, actor)
                pytest.fail('revoked or downgraded actor passed write authorization')
            except HTTPException as error:
                return error.status_code
    with Session(api.engine, autoflush=False) as db, ThreadPoolExecutor(max_workers=1) as pool:
        api.c.lock_owners(db, ledger.owner)
        blocker = db.scalar(text('SELECT pg_backend_pid()'))
        if change == 'legacy':
            db.query(api.m.WalletShare).filter_by(wallet_id=ledger.wallet).delete()
        elif change == 'downgrade':
            db.query(api.m.SpaceMember).filter_by(space_id=ledger.space).update({'role': 'view'})
            db.query(api.m.WalletShare).filter_by(wallet_id=ledger.wallet).update({'permission': 'view'})
        else:
            db.query(api.m.SpaceMember).filter_by(space_id=ledger.space).delete()
            db.query(api.m.WalletShare).filter_by(wallet_id=ledger.wallet).delete()
        future = pool.submit(write)
        try:
            wait(started); blocked(api.engine, pid[0], blocker)
        finally:
            db.commit()
        assert future.result(timeout=5) == (409 if change == 'legacy' else 403)


def test_authorized_write_finishes_before_revocation(api, ledger):
    started = threading.Event(); pid = []
    def revoke():
        with Session(api.engine, autoflush=False) as db:
            pid.append(db.scalar(text('SELECT pg_backend_pid()'))); started.set()
            return api.spaces.remove_member(ledger.space, ledger.email, db.get(api.m.User, ledger.owner), db)
    with Session(api.engine, autoflush=False) as db, ThreadPoolExecutor(max_workers=1) as pool:
        api.spaces.establish_scope(request(f'/api/transactions?space_id={ledger.space}', 'POST'),
                                  db, db.get(api.m.User, ledger.member))
        blocker = db.scalar(text('SELECT pg_backend_pid()'))
        future = pool.submit(revoke)
        try:
            wait(started); blocked(api.engine, pid[0], blocker)
            row = api.index.add_transaction(db, ledger.owner, transaction(api, ledger.wallet))
            ident = row.id
        finally:
            db.commit()
        future.result(timeout=5)
    with Session(api.engine) as db:
        assert db.get(api.m.Transaction, ident).recorded_by_id == ledger.member
        assert not db.query(api.m.SpaceMember).filter_by(space_id=ledger.space).first()


def test_wallet_delete_captures_committed_writer(api, ledger):
    started = threading.Event(); pid = []
    def delete():
        with Session(api.engine, autoflush=False) as db:
            pid.append(db.scalar(text('SELECT pg_backend_pid()'))); started.set()
            api.index.delete_wallet(ledger.wallet, True, db.get(api.m.User, ledger.owner), db)
    with Session(api.engine, autoflush=False) as db, ThreadPoolExecutor(max_workers=1) as pool:
        api.c.lock_owners(db, ledger.owner)
        blocker = db.scalar(text('SELECT pg_backend_pid()'))
        row = api.index.add_transaction(db, ledger.owner, transaction(api, ledger.wallet, 'Captured writer'))
        ident = row.id
        future = pool.submit(delete)
        try:
            wait(started); blocked(api.engine, pid[0], blocker)
        finally:
            db.commit()
        future.result(timeout=5)
    from api.reliability_models import TrashItem
    with Session(api.engine) as db:
        recovery = json.loads(db.query(api.m.RecoveryPoint).filter_by(user_id=ledger.owner).one().payload)
        trash = json.loads(db.query(TrashItem).filter_by(user_id=ledger.owner).one().payload)
        assert ident in {row['id'] for row in recovery['transactions']}
        assert ident in {row['id'] for row in trash['transactions']}
        assert db.get(api.m.Transaction, ident) is None


def test_clear_capture_prevents_late_uncoordinated_writer(api, ledger):
    from fastapi import HTTPException
    with Session(api.engine, autoflush=False) as capture:
        actor = capture.get(api.m.User, ledger.owner)
        api.c.lock_owners(capture, actor.id)
        point = api.safety.save_recovery(capture, actor, actor, 'clear')
        def late_write():
            with Session(api.engine, autoflush=False) as db:
                db.add(api.m.Transaction(user_id=ledger.owner, wallet_id=ledger.wallet, type='expense',
                       amount=1, description='Late writer', date=api.index.ledger_now()))
                try:
                    db.commit()
                except HTTPException as error:
                    db.rollback()
                    return error.status_code
                return 200
        with ThreadPoolExecutor(max_workers=1) as pool:
            assert pool.submit(late_write).result(timeout=5) == 409
        api.safety.clear_budget(capture, actor.id)
        capture.commit()
        saved = json.loads(point.payload)
        assert ledger.tx in {row['id'] for row in saved['transactions']}
    with Session(api.engine) as db:
        assert not db.query(api.m.Transaction).filter_by(user_id=ledger.owner).first()


def test_restore_endpoint_capture_prevents_late_writer(api, ledger, monkeypatch):
    from fastapi import HTTPException
    from fastapi.encoders import jsonable_encoder
    with Session(api.engine, autoflush=False) as db:
        archive = api.index.export_backup(db.get(api.m.User, ledger.owner), db)
    captured, resume = threading.Event(), threading.Event()
    original = api.index.save_recovery
    def capture(*args):
        point = original(*args)
        captured.set(); wait(resume)
        return point
    monkeypatch.setattr(api.index, 'save_recovery', capture)
    monkeypatch.setattr('api.account_security.confirmed', lambda *args: None)
    def restore():
        with Session(api.engine, autoflush=False) as db:
            return asyncio.run(api.index.restore_backup(request('/api/backup/restore', 'POST',
                body=json.dumps(jsonable_encoder(archive)).encode()), db.get(api.m.User, ledger.owner), db))
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(restore)
        try:
            wait(captured)
            with Session(api.engine, autoflush=False) as db:
                db.add(api.m.Transaction(user_id=ledger.owner, wallet_id=ledger.wallet, type='expense',
                       amount=1, description='Lost writer', date=api.index.ledger_now()))
                with pytest.raises(HTTPException) as error:
                    db.commit()
                assert error.value.status_code == 409
                db.rollback()
        finally:
            resume.set()
        assert future.result(timeout=5) == {'ok': True}
    with Session(api.engine) as db:
        saved = json.loads(db.query(api.m.RecoveryPoint).filter_by(user_id=ledger.owner).one().payload)
        assert ledger.tx in {row['id'] for row in saved['transactions']}
        assert db.query(api.m.Transaction).filter_by(user_id=ledger.owner, description='Synthetic').count() == 1
        assert not db.query(api.m.Transaction).filter_by(user_id=ledger.owner, description='Lost writer').first()


@pytest.mark.parametrize('mutation', ['flush', 'bulk', 'note'])
def test_late_financial_writers_cannot_bypass_claim(api, ledger, mutation):
    from fastapi import HTTPException
    with Session(api.engine, autoflush=False) as capture:
        api.c.lock_owners(capture, ledger.owner)
        def late_write():
            with Session(api.engine, autoflush=False) as db:
                try:
                    if mutation == 'bulk':
                        db.query(api.m.Transaction).filter_by(id=ledger.tx).update({'description': 'Late'})
                    elif mutation == 'note':
                        db.add(api.m.Note(user_id=ledger.owner, title='Late', content='Synthetic'))
                    else:
                        db.get(api.m.Transaction, ledger.tx).description = 'Late'
                    db.commit()
                except HTTPException as error:
                    db.rollback()
                    return error.status_code
                return 200
        with ThreadPoolExecutor(max_workers=1) as pool:
            assert pool.submit(late_write).result(timeout=5) == 409


def test_wallet_permission_proof_is_rechecked_after_commit(api, ledger):
    from fastapi import HTTPException
    with Session(api.engine, autoflush=False) as stale:
        actor = stale.get(api.m.User, ledger.member)
        api.ext.share_for_wallet(stale, actor, ledger.wallet)
        stale.commit()
        with Session(api.engine, autoflush=False) as db:
            api.c.lock_owners(db, ledger.owner)
            db.query(api.m.WalletShare).filter_by(wallet_id=ledger.wallet).update({'permission': 'view'})
            db.commit()
        stale.add(api.m.WalletBalanceCheck(wallet_id=ledger.wallet, checked_by_id=ledger.member,
                  checked_by_name='Member', expected_balance=0, observed_balance=0, currency='KWD'))
        with pytest.raises(HTTPException) as error:
            stale.commit()
        assert error.value.status_code == 403
        stale.rollback()


@pytest.mark.parametrize('route', ['transactions', 'dashboard', 'analytics', 'global'])
def test_read_with_no_recurrence_work_never_claims_owner(api, ledger, route, monkeypatch):
    def forbidden(*args, **kwargs):
        pytest.fail('read with no due recurrence work claimed an owner')
    monkeypatch.setattr(api.index, 'lock_owners', forbidden)
    with Session(api.engine, autoflush=False) as db:
        user = db.get(api.m.User, ledger.owner)
        if route == 'global':
            assert api.index.materialize_recurring(db) == 0
        elif route == 'transactions':
            api.index.transactions(user=user, db=db, limit=50, scope='personal',
                                   options=(None, None, None, 'newest', 0, False))
        elif route == 'dashboard':
            api.index.dashboard(user=user, db=db)
        else:
            api.index.analytics(months=6, user=user, db=db)
        assert ledger.owner not in api.c._claims(db)


def test_export_does_not_borrow_second_slot_or_rollback_pending_data(api, ledger):
    small = create_engine(api.engine.url, pool_size=1, max_overflow=0, pool_timeout=.2)
    try:
        with Session(small, autoflush=False) as db:
            actor = db.get(api.m.User, ledger.owner)
            db.add(api.m.Note(user_id=ledger.owner, title='Pending', content='Synthetic'))
            assert small.pool.checkedout() == 1
            with api.c.snapshot_session(db, ledger.owner) as snapshot:
                assert snapshot.scalar(text('SHOW transaction_read_only')) == 'on'
            archive = api.index.export_backup(actor, db)
            assert small.pool.checkedout() == 1
            assert len(db.new) == 1
            assert not any(row['title'] == 'Pending' for row in archive['notes'])
            db.commit()
        with Session(small) as db:
            assert db.query(api.m.Note).filter_by(user_id=ledger.owner, title='Pending').count() == 1
    finally:
        small.dispose()


def test_savepoint_rollback_forgets_released_claim(api, ledger):
    from fastapi import HTTPException
    with Session(api.engine, autoflush=False) as db:
        db.get(api.m.User, ledger.owner)
        nested = db.begin_nested()
        api.c.lock_owners(db, ledger.owner)
        nested.rollback()
        with Session(api.engine, autoflush=False) as competing:
            api.c.lock_owners(competing, ledger.owner)
            db.get(api.m.Transaction, ledger.tx).description = 'After rolled-back claim'
            with pytest.raises(HTTPException) as error:
                db.flush()
            assert error.value.status_code == 409
            db.rollback()


def diagnose_load(engine, workers, seconds):
    from scripts.verify_load import exercise
    from fastapi.testclient import TestClient
    failures, database_errors, exceptions = Counter(), Counter(), Counter()
    mutex = threading.Lock()
    original = TestClient.request
    from api import index
    old_materialize = index.materialize_recurring_for_user
    if os.getenv('BUDGETLY_REPRODUCE_READ_CLAIMS') == '1':
        def old_read_claim(db, user_id):
            index.lock_owners(db, user_id)
            return old_materialize(db, user_id)
        index.materialize_recurring_for_user = old_read_claim
    details = {'Workspace is changing. Retry this request.': 'OWNER_BUSY',
               'Wallet permissions changed. Refresh and try again.': 'ACL_CHANGED',
               'Wallet changed. Refresh and try again.': 'WALLET_CHANGED'}
    def traced(client, method, url, **kwargs):
        response = original(client, method, url, **kwargs)
        if response.status_code >= 400:
            try:
                body = response.json()
                code = details.get(body.get('detail'), body.get('code', 'HTTP_STATUS'))
                if code not in {*details.values(), 'STORAGE_UNAVAILABLE', 'HTTP_STATUS'}:
                    code = 'HTTP_STATUS'
            except ValueError:
                code = 'NON_JSON'
            with mutex:
                failures[(str(url).split('?')[0], response.status_code, code)] += 1
        return response
    def database_error(context):
        with mutex:
            database_errors[(type(context.original_exception).__name__,
                             getattr(context.original_exception, 'sqlstate', None))] += 1
    class Sanitized(logging.Handler):
        def emit(self, record):
            if record.msg == 'request_failure id=%s type=%s':
                with mutex:
                    exceptions[str(record.args[1])] += 1
    logger = logging.getLogger('flowbudget')
    handler = Sanitized()
    handlers, propagate, level = logger.handlers[:], logger.propagate, logger.level
    logger.handlers, logger.propagate, logger.level = [handler], False, logging.ERROR
    TestClient.request = traced
    event.listen(engine, 'handle_error', database_error)
    try:
        evidence = exercise(engine, seconds, workers, 1000, False)
        evidence['sanitized_failures'] = [{'route': route, 'status': status, 'code': code, 'count': count}
                                         for (route, status, code), count in failures.items()]
        evidence['database_errors'] = [{'type': kind, 'sqlstate': state, 'count': count}
                                        for (kind, state), count in database_errors.items()]
        evidence['application_error_types'] = dict(exceptions)
        print(json.dumps(evidence, indent=2))
        return 0 if evidence['passed'] else 1
    finally:
        TestClient.request = original
        index.materialize_recurring_for_user = old_materialize
        logger.handlers, logger.propagate, logger.level = handlers, propagate, level
        event.remove(engine, 'handle_error', database_error)


def test_scheduled_post_rechecks_revoked_access(api, ledger):
    started = threading.Event(); pid = []
    with Session(api.engine, autoflush=False) as db:
        plan = api.m.PlannedTransaction(owner_id=ledger.owner, created_by_id=ledger.member,
             wallet_id=ledger.wallet, type='expense', amount=1, description='Scheduled',
             status='scheduled', due_at=api.index.ledger_now() - timedelta(days=1), reminder_enabled=False)
        db.add(plan); db.commit(); ident = plan.id
    def post():
        with Session(api.engine, autoflush=False) as db:
            pid.append(db.scalar(text('SELECT pg_backend_pid()'))); started.set()
            return api.planned.post_due(db)
    with Session(api.engine, autoflush=False) as db, ThreadPoolExecutor(max_workers=1) as pool:
        api.c.lock_owners(db, ledger.owner)
        blocker = db.scalar(text('SELECT pg_backend_pid()'))
        db.query(api.m.WalletShare).filter_by(wallet_id=ledger.wallet).delete()
        future = pool.submit(post)
        try:
            wait(started); blocked(api.engine, pid[0], blocker)
        finally:
            db.commit()
        assert future.result(timeout=5) == 0
    with Session(api.engine) as db:
        plan = db.get(api.m.PlannedTransaction, ident)
        assert plan.status == 'failed' and plan.posted_transaction_id is None


def test_export_uses_one_snapshot_while_writer_commits(api, ledger):
    captured, resume = threading.Event(), threading.Event()
    def pause(connection, cursor, statement, parameters, context, executemany):
        if threading.current_thread().name.startswith('snapshot') and 'FROM wallets' in statement and not captured.is_set():
            captured.set(); wait(resume)
    event.listen(Engine, 'after_cursor_execute', pause)
    def export():
        with Session(api.engine, autoflush=False) as db:
            return api.index.export_backup(db.get(api.m.User, ledger.owner), db)
    try:
        with ThreadPoolExecutor(max_workers=1, thread_name_prefix='snapshot') as pool:
            future = pool.submit(export)
            try:
                wait(captured)
                with Session(api.engine, autoflush=False) as db:
                    api.c.lock_owners(db, ledger.owner)
                    wallet = api.m.Wallet(user_id=ledger.owner, name='During export', initial_balance=0)
                    db.add(wallet); db.flush()
                    added = api.index.add_transaction(db, ledger.owner, transaction(api, wallet.id))
                    added_id = added.id; db.commit()
            finally:
                resume.set()
            archive = future.result(timeout=5)
    finally:
        event.remove(Engine, 'after_cursor_execute', pause)
    ids = {row['id'] for row in archive['wallets']}
    assert all(row['wallet_id'] in ids for row in archive['transactions'])
    assert added_id not in {row['id'] for row in archive['transactions']}
    from api.backup_validation import validate_archive_records
    validate_archive_records(archive, api.index.BACKUP_COLLECTION_LIMITS)


def test_deletion_serializes_drive_callback_installation(api, monkeypatch):
    from cryptography.fernet import Fernet
    from api.reliability_models import AccountSession
    cipher = Fernet(Fernet.generate_key())
    monkeypatch.setattr(api.drive, 'configuration', lambda: (('client', 'secret', 'redirect'), cipher))
    with Session(api.engine, autoflush=False) as db:
        suffix = secrets.token_hex(8)
        owner = api.m.User(username='Deleting', email=f'delete-{suffix}@test.invalid', password_hash='unused')
        db.add(owner); db.flush(); ident = owner.id
        session = AccountSession(id=suffix, user_id=ident)
        db.add_all([session, api.drive.GoogleDriveConnection(user_id=ident,
                   refresh_token=cipher.encrypt(b'old-grant').decode())]); db.commit()
    revoking, resume, started = threading.Event(), threading.Event(), threading.Event()
    pids, seen = [], []
    class Http:
        def __init__(self, **kwargs): pass
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def post(self, url, data):
            seen.append(data['token']); revoking.set(); wait(resume)
            return SimpleNamespace(status_code=200, raise_for_status=lambda: None)
    monkeypatch.setattr(api.auth.httpx, 'Client', Http)
    def delete():
        with Session(api.engine, autoflush=False) as db:
            pids.append(db.scalar(text('SELECT pg_backend_pid()')))
            api.auth.revoke_google_access(db, ident)
            db.query(api.drive.GoogleDriveConnection).filter_by(user_id=ident).delete()
            db.query(AccountSession).filter_by(user_id=ident).delete()
            db.delete(db.get(api.m.User, ident)); db.commit()
    def callback():
        with Session(api.engine, autoflush=False) as db:
            pid = db.scalar(text('SELECT pg_backend_pid()')); pids.append(pid); started.set()
            attempt = SimpleNamespace(user_id=ident, session_id=suffix,
                        credential_digest=hashlib.sha256(b'unused').hexdigest())
            valid = api.drive.consent_session(db, attempt)
            if valid:
                db.query(api.drive.GoogleDriveConnection).filter_by(user_id=ident).update(
                    {'refresh_token': cipher.encrypt(b'new-grant').decode()})
            db.commit()
            return valid
    with ThreadPoolExecutor(max_workers=2) as pool:
        deletion = pool.submit(delete)
        try:
            wait(revoking)
            install = pool.submit(callback); wait(started)
            blocked(api.engine, pids[1], pids[0])
        finally:
            resume.set()
        deletion.result(timeout=5)
        assert install.result(timeout=5) is False
    assert seen == ['old-grant']
    with Session(api.engine) as db:
        assert db.get(api.m.User, ident) is None
        assert db.get(api.drive.GoogleDriveConnection, ident) is None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', required=True)
    parser.add_argument('--load-workers', type=int, choices=[16, 32])
    parser.add_argument('--seconds', type=int, default=15, choices=range(1, 31))
    parser.add_argument('--reproduce-read-claims', action='store_true')
    args = parser.parse_args()
    url = harness.validate_url(args.url)
    if any(name == 'api' or name.startswith('api.') for name in sys.modules):
        raise RuntimeError('Use a fresh process')
    harness.isolated_environment(url)
    with harness.network_guard(url.host, url.port):
        admin = create_engine(url, connect_args={'connect_timeout': 5, 'passfile': os.devnull, 'sslmode': 'disable'})
        try:
            with harness.owned_schema(admin) as schema:
                scoped = url.update_query_dict({'options': f'-csearch_path={schema} -cstatement_timeout=8000 -clock_timeout=6000'})
                os.environ['FLOWBUDGET_DATABASE_URL'] = scoped.render_as_string(hide_password=False)
                os.environ['BUDGETLY_SECURITY_RACE_RUN'] = '1'
                if args.reproduce_read_claims:
                    os.environ['BUDGETLY_REPRODUCE_READ_CLAIMS'] = '1'
                if args.load_workers:
                    from api.database import engine
                    try:
                        return diagnose_load(engine, args.load_workers, args.seconds)
                    finally:
                        engine.dispose()
                return pytest.main([str(Path(__file__).resolve()), '-q', '--noconftest',
                                    '--tb=short', '-p', 'no:cacheprovider'])
        finally:
            admin.dispose()


if __name__ == '__main__':
    raise SystemExit(main())
