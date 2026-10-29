"""Offline security regressions using only synthetic database records."""
import hashlib
import asyncio
from datetime import timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from starlette.requests import Request

from api import account_security as security, google_auth as google
from api.auth_dependency import current_user
from api.database import Base
from api.index import auth_serializer
from api.models import User, utc_now
from api.reliability_models import AccountSession, RateBucket, ResetToken


@pytest.fixture
def db():
    engine = create_engine('sqlite://')
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        user = User(username='Synthetic', email='synthetic@example.invalid', password_hash='old-hash')
        session.add(user)
        session.flush()
        session.add(AccountSession(id='review-session', user_id=user.id, verified_at=utc_now()))
        session.commit()
        yield session
    engine.dispose()


def ready_flow(db):
    user = db.query(User).one()
    row = google.GoogleAuthState(digest='a'*64, poll_digest='b'*64,
        nonce='nonce', verifier='', client_id='synthetic-client', redirect_uri='https://example.invalid',
        expires_at=utc_now()+timedelta(minutes=5), status='ready', user_id=user.id,
        credential=google.digest(user.password_hash))
    db.add(row)
    db.commit()
    return user, row


def test_reset_invalidates_pending_google_signin_and_sessions(db, monkeypatch):
    user, row = ready_flow(db)
    secret = 'synthetic-reset-token-123'
    db.add(ResetToken(digest=google.digest(secret), user_id=user.id, expires=utc_now()+timedelta(minutes=5)))
    db.commit()
    monkeypatch.setattr(security, 'hash_password', lambda _: 'new-hash')
    security.complete_reset(security.ResetIn(token=secret, password='new-password-123'), db)
    db.refresh(row)
    assert row.status == 'cancelled'
    assert db.get(AccountSession, 'review-session').revoked
    with pytest.raises(HTTPException) as error:
        google.session_result(db, row, 'ready')
    assert error.value.status_code == 400
    with pytest.raises(HTTPException):
        security.complete_reset(security.ResetIn(token=secret, password='new-password-456'), db)


def test_signout_all_invalidates_pending_google_signin(db):
    user, row = ready_flow(db)
    security.signout_all(user, db)
    db.refresh(row)
    assert row.status == 'cancelled'
    with pytest.raises(HTTPException):
        google.session_result(db, row, 'ready')


def test_google_result_rejects_changed_credentials(db):
    user, row = ready_flow(db)
    user.password_hash = 'changed-hash'
    db.commit()
    with pytest.raises(HTTPException) as error:
        google.session_result(db, row, 'ready')
    assert error.value.status_code == 400
    assert db.query(AccountSession).count() == 1


@pytest.mark.parametrize('failure', ['foreign', 'revoked', 'expired'])
def test_confirmation_requires_live_owned_session(db, failure):
    user = db.query(User).one()
    session = db.get(AccountSession, 'review-session')
    if failure == 'foreign':
        user = User(id=999)
    elif failure == 'revoked':
        session.revoked = True
    else:
        session.created_at = utc_now()-timedelta(days=2)
    request = Request({'type': 'http'})
    request.state.session_id = session.id
    with pytest.raises(HTTPException) as error:
        security.confirmed(request, db, user)
    assert error.value.status_code == 428


def test_limiter_uses_database_count_despite_stale_identity_map(db):
    key = 'synthetic-limit'
    digest = hashlib.sha256(key.encode()).hexdigest()
    row = RateBucket(key=digest, count=0, started=utc_now())
    db.add(row)
    db.commit()
    db.expire_on_commit = False
    assert row.count == 0
    db.execute(RateBucket.__table__.update().where(RateBucket.key == digest).values(count=5))
    db.commit()
    with pytest.raises(HTTPException) as error:
        security.limit(db, key, maximum=5)
    assert error.value.status_code == 429
    db.refresh(row)
    assert row.count == 6


@pytest.mark.parametrize('expired', [False, True])
def test_ended_bearer_fails_even_with_matching_credentials(db, expired):
    user = db.query(User).one()
    session = db.get(AccountSession, 'review-session')
    if expired:
        session.created_at = utc_now()-timedelta(days=2)
    else:
        session.revoked = True
    db.commit()
    token = auth_serializer.dumps({'user_id': user.id, 'sid': session.id,
        'credential': google.digest(user.password_hash)})
    request = Request({'type': 'http', 'headers': [(b'authorization', ('Bearer '+token).encode())]})
    with pytest.raises(HTTPException) as error:
        current_user(request, db)
    assert error.value.status_code == 401


def test_drive_partial_failure_retains_retry_token(db, monkeypatch):
    from cryptography.fernet import Fernet
    from api import google_drive as drive
    key = Fernet.generate_key()
    cipher = Fernet(key)
    monkeypatch.setenv('GOOGLE_DRIVE_ENCRYPTION_KEY', key.decode())
    user = db.query(User).one()
    db.add(drive.GoogleDriveConnection(user_id=user.id,
        refresh_token=cipher.encrypt(b'synthetic-drive-grant').decode()))
    db.commit()
    monkeypatch.setattr(drive, 'configuration', lambda: (['client', 'secret', 'redirect'], cipher))
    calls = []
    async def failed_provider(*args, **kwargs):
        calls.append(kwargs['data']['token'])
        raise HTTPException(502, 'Synthetic failure')
    monkeypatch.setattr(drive, 'google_request', failed_provider)
    with pytest.raises(HTTPException) as error:
        asyncio.run(drive.disconnect(user, db))
    assert error.value.status_code == 502
    assert db.get(drive.GoogleDriveConnection, user.id).refresh_token is None
    from api.models import ProviderRevocationJob
    job = db.query(ProviderRevocationJob).one()
    assert cipher.decrypt(job.token.encode()) == b'synthetic-drive-grant'
    assert job.status == 'pending'
    async def succeeded_provider(*args, **kwargs):
        import httpx
        calls.append(kwargs['data']['token'])
        return httpx.Response(200)
    monkeypatch.setattr(drive, 'google_request', succeeded_provider)
    response = asyncio.run(drive.disconnect(user, db))
    assert b'"revocation_pending":false' in response.body
    assert calls == ['synthetic-drive-grant', 'synthetic-drive-grant']
    db.refresh(job)
    assert job.status == 'completed' and job.token is None


def test_revocation_worker_retains_unreadable_token_and_releases_lease(db, monkeypatch):
    from api import provider_revocation as worker
    from api.models import ProviderRevocationJob
    monkeypatch.delenv('GOOGLE_DRIVE_ENCRYPTION_KEY', raising=False)
    job_id = worker.enqueue(db, 12345, 'synthetic-unreadable-ciphertext')
    db.commit()
    assert worker.retry_due(db) == {'completed': 0, 'failed': 1}
    job = db.get(ProviderRevocationJob, job_id)
    assert job.token == 'synthetic-unreadable-ciphertext'
    assert job.error == 'credential_unreadable' and job.attempts == 1
    assert job.lease_id is None and job.next_attempt_at > utc_now()


def test_revocation_lease_recovery_and_stale_completion(db):
    from api import provider_revocation as worker
    from api.models import ProviderRevocationJob
    job_id = worker.enqueue(db, 12345, 'encrypted-token')
    db.commit()
    old_lease, _ = worker.claim(db, job_id)
    assert worker.claim(db, job_id) is None
    job = db.get(ProviderRevocationJob, job_id)
    job.lease_until = utc_now()-timedelta(seconds=1)
    db.commit()
    new_lease, _ = worker.claim(db, job_id)
    worker.finish(db, job_id, old_lease)
    db.refresh(job)
    assert job.token == 'encrypted-token' and job.lease_id == new_lease
    worker.finish(db, job_id, new_lease)
    db.refresh(job)
    assert job.token is None and job.status == 'completed'


def test_revocation_survives_deletion_and_retry_in_fresh_session(db, monkeypatch):
    from api import provider_revocation as worker
    from api.models import ProviderRevocationJob
    from cryptography.fernet import Fernet
    import httpx
    key = Fernet.generate_key()
    monkeypatch.setenv('GOOGLE_DRIVE_ENCRYPTION_KEY', key.decode())
    user = db.query(User).one()
    job_id = worker.enqueue(db, user.id, Fernet(key).encrypt(b'synthetic-revocation').decode())
    db.query(AccountSession).delete()
    db.delete(user)
    db.commit()
    original = httpx.Client
    calls = []
    def provider(request):
        calls.append(request.url)
        return httpx.Response(400, stream=httpx.ByteStream(b'{"error":"invalid_token"}'))
    monkeypatch.setattr(worker.httpx, 'Client', lambda **kwargs: original(
        transport=httpx.MockTransport(provider), **kwargs))
    with Session(db.get_bind()) as restarted:
        assert worker.retry_due(restarted) == {'completed': 1, 'failed': 0}
        assert restarted.get(ProviderRevocationJob, job_id).token is None
    assert len(calls) == 1


def test_drive_revocation_pending_blocks_reconnect(db, monkeypatch):
    from api import google_drive as drive, provider_revocation as worker
    from cryptography.fernet import Fernet
    user = db.query(User).one()
    key = Fernet.generate_key()
    monkeypatch.setattr(drive, 'configuration', lambda: (['client', 'secret', 'redirect'], Fernet(key)))
    worker.enqueue(db, user.id, 'encrypted-token')
    db.commit()
    request = Request({'type': 'http'})
    request.state.session_id = 'review-session'
    with pytest.raises(HTTPException) as error:
        drive.start(request, user, db)
    assert error.value.status_code == 409
    assert b'"revocation_pending":true' in drive.status(user, db).body


def test_signout_during_exchange_queues_late_grant(db, monkeypatch):
    from api import google_drive as drive
    from api.models import ProviderRevocationJob
    from cryptography.fernet import Fernet
    import httpx
    user = db.query(User).one()
    key = Fernet.generate_key()
    cipher = Fernet(key)
    monkeypatch.setattr(drive, 'configuration', lambda: (['client', 'secret', 'redirect'], cipher))
    request = Request({'type': 'http'})
    request.state.session_id = 'review-session'
    import json
    from urllib.parse import parse_qs, urlsplit
    flow = json.loads(drive.start(request, user, db).body)
    state = parse_qs(urlsplit(flow['authorization_url']).query)['state'][0]
    async def provider(*args, **kwargs):
        security.revoke_session('review-session', user, db)
        return httpx.Response(200, json={'scope': drive.SCOPE, 'refresh_token': 'synthetic-late-grant'})
    monkeypatch.setattr(drive, 'google_request', provider)
    asyncio.run(drive.callback(state=state, code='synthetic', error=None, db=db))
    assert db.get(drive.GoogleDriveConnection, user.id).refresh_token is None
    job = db.query(ProviderRevocationJob).one()
    assert cipher.decrypt(job.token.encode()) == b'synthetic-late-grant'
    assert job.status == 'pending'


def test_daily_maintenance_dispatches_revocation_worker(db, monkeypatch):
    from api import operations, planned, update_push, provider_revocation as worker
    monkeypatch.setenv('CRON_SECRET', 'synthetic-cron')
    monkeypatch.setattr(planned, 'post_due', lambda _: 0)
    def automatic_snapshots(actual, *, force_external):
        assert actual is db
        assert force_external is False
        return {'ok': True}
    monkeypatch.setattr(operations, 'daily_snapshots', automatic_snapshots)
    monkeypatch.setattr(update_push, 'dispatch_updates', lambda _: {})
    calls = []
    monkeypatch.setattr(worker, 'retry_due', lambda actual: calls.append(actual) or {'completed': 1, 'failed': 0})
    request = Request({'type': 'http', 'headers': [(b'authorization', b'Bearer synthetic-cron')]})
    assert operations.maintenance(request, db)['provider_revocations']['completed'] == 1
    assert calls == [db]


def test_drive_migration_cancels_legacy_attempt_and_preserves_connection():
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy import text, inspect
    import importlib
    migration = importlib.import_module('migrations.versions.f43c912ab706_drive_consent_revocation')
    engine = create_engine('sqlite://')
    with engine.begin() as connection:
        connection.execute(text('CREATE TABLE google_drive_connections (user_id INTEGER PRIMARY KEY, refresh_token TEXT)'))
        connection.execute(text('CREATE TABLE google_drive_oauth_attempts (id TEXT PRIMARY KEY, status TEXT, verifier TEXT)'))
        connection.execute(text("INSERT INTO google_drive_connections VALUES (1, 'encrypted-kept')"))
        connection.execute(text("INSERT INTO google_drive_oauth_attempts VALUES ('old', 'pending', 'verifier')"))
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
        assert connection.execute(text('SELECT refresh_token, generation FROM google_drive_connections')).one() == ('encrypted-kept', 0)
        assert connection.execute(text('SELECT status, verifier FROM google_drive_oauth_attempts')).one() == ('cancelled', None)
        assert 'provider_revocation_jobs' in inspect(connection).get_table_names()
    engine.dispose()


@pytest.mark.parametrize('revocation', ['single', 'all', 'reset'])
def test_drive_consent_rejects_session_revocation(db, monkeypatch, revocation):
    from cryptography.fernet import Fernet
    import httpx
    from api import google_drive as drive
    user = db.query(User).one()
    cipher = Fernet(Fernet.generate_key())
    state = 'synthetic-drive-state-123456'
    attempt = drive.GoogleDriveOAuthAttempt(id='c'*64, user_id=user.id,
        state_hash=google.digest(state), poll_hash='d'*64,
        verifier=cipher.encrypt(b'verifier').decode(),
        expires_at=utc_now()+timedelta(minutes=5), session_id='review-session',
        credential_digest=google.digest(user.password_hash), connection_generation=0)
    db.add(drive.GoogleDriveConnection(user_id=user.id))
    db.add(attempt)
    db.commit()
    if revocation == 'single':
        security.revoke_session('review-session', user, db)
    elif revocation == 'all':
        security.signout_all(user, db)
    else:
        secret = 'synthetic-drive-reset-token'
        db.add(ResetToken(digest=google.digest(secret), user_id=user.id,
            expires=utc_now()+timedelta(minutes=5)))
        db.commit()
        monkeypatch.setattr(security, 'hash_password', lambda _: 'new-hash')
        security.complete_reset(security.ResetIn(token=secret, password='new-password-123'), db)
    monkeypatch.setattr(drive, 'configuration', lambda: (['client', 'secret', 'redirect'], cipher))
    async def provider(*args, **kwargs):
        return httpx.Response(200, json={'scope': drive.SCOPE, 'refresh_token': 'synthetic-grant'})
    monkeypatch.setattr(drive, 'google_request', provider)
    with pytest.raises(HTTPException):
        asyncio.run(drive.callback(state=state, code='synthetic-code', error=None, db=db))
    db.refresh(attempt)
    assert db.get(AccountSession, 'review-session').revoked
    assert attempt.status == 'cancelled'
    assert db.get(drive.GoogleDriveConnection, user.id).refresh_token is None


def test_eight_workers_claim_one_revocation_job(tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    from api import provider_revocation as worker
    from api.models import ProviderRevocationJob
    engine = create_engine('sqlite:///' + str(tmp_path / 'synthetic-queue.db'), connect_args={'timeout': 10})
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        job_id = worker.enqueue(session, 12345, 'encrypted-token')
        session.commit()
    barrier = Barrier(8)
    def race(_):
        with Session(engine) as session:
            barrier.wait(timeout=10)
            return worker.claim(session, job_id)
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(race, range(8)))
    assert sum(result is not None for result in results) == 1
    with Session(engine) as session:
        assert session.get(ProviderRevocationJob, job_id).token == 'encrypted-token'
    engine.dispose()


def test_postgres_queue_and_consent_sql_compiles():
    from sqlalchemy.dialects import postgresql
    from sqlalchemy.schema import CreateTable
    from api.models import ProviderRevocationJob
    from api import google_drive as drive
    dialect = postgresql.dialect()
    for table in [ProviderRevocationJob.__table__, drive.GoogleDriveConnection.__table__, drive.GoogleDriveOAuthAttempt.__table__]:
        assert str(CreateTable(table).compile(dialect=dialect))
    claim = ProviderRevocationJob.__table__.update().where(
        ProviderRevocationJob.status == 'pending', ProviderRevocationJob.lease_until <= utc_now()).values(lease_id='lease')
    assert 'UPDATE provider_revocation_jobs' in str(claim.compile(dialect=dialect))


def test_worker_bound_and_backoff_preserve_failed_jobs(db, monkeypatch):
    from api import provider_revocation as worker
    from api.models import ProviderRevocationJob
    from cryptography.fernet import Fernet
    import httpx
    key = Fernet.generate_key()
    monkeypatch.setenv('GOOGLE_DRIVE_ENCRYPTION_KEY', key.decode())
    for _ in range(12):
        worker.enqueue(db, 12345, Fernet(key).encrypt(b'synthetic-token').decode())
    db.commit()
    original = httpx.Client
    monkeypatch.setattr(worker.httpx, 'Client', lambda **kwargs: original(
        transport=httpx.MockTransport(lambda _: httpx.Response(503, stream=httpx.ByteStream(b''))), **kwargs))
    assert worker.retry_due(db, maximum=999) == {'completed': 0, 'failed': 10}
    db.expire_all()
    rows = db.query(ProviderRevocationJob).all()
    assert sum(row.attempts == 1 for row in rows) == 10
    assert all(row.status == 'pending' and row.token and row.lease_id is None for row in rows)


def test_legacy_baselining_installs_drive_columns():
    from sqlalchemy import text, inspect
    from api.schema_migrations import apply_migrations
    from api.index import ensure_note_columns
    engine = create_engine('sqlite://')
    Base.metadata.create_all(engine)
    with engine.begin() as connection:
        for table, names in [('google_drive_connections', ['generation']),
                ('google_drive_oauth_attempts', ['session_id', 'credential_digest', 'connection_generation'])]:
            for name in names:
                connection.execute(text(f'ALTER TABLE {table} DROP COLUMN {name}'))
        apply_migrations(connection, ensure_note_columns)
        assert 'session_id' in {c['name'] for c in inspect(connection).get_columns('google_drive_oauth_attempts')}
    engine.dispose()
