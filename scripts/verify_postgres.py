"""Opt-in synthetic concurrent ledger verification against disposable local PostgreSQL."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from decimal import Decimal
import json
import os
from pathlib import Path
import re
import secrets
import socket
import sys
import threading
import time

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url


class VerificationFailure(RuntimeError):
    """Synthetic assertion text that is safe to include in evidence."""


def validate_url(value):
    """Reject libpq routing overrides, aliases, remote hosts and general databases."""
    try:
        url = make_url(value)
        valid = (url.drivername in {'postgresql', 'postgresql+psycopg'}
                 and url.host in {'127.0.0.1', '::1'}
                 and url.port is not None and 1 <= url.port <= 65535
                 and bool(url.username) and not url.query
                 and bool(re.fullmatch(r'budgetly_verification_[a-z0-9_]+', url.database or '')))
    except Exception:
        valid = False
    if not valid:
        raise ValueError('Require an explicit PostgreSQL URL with numeric loopback host, port, '
                         'user, budgetly_verification_ database suffix and no query options')
    return url.set(drivername='postgresql+psycopg')


def isolated_environment(url):
    retained = {k: v for k, v in os.environ.items() if k.upper() in {
        'PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'COMSPEC', 'PATHEXT',
    }}
    os.environ.clear()
    os.environ.update(retained)
    os.environ.update(FLOWBUDGET_DATABASE_URL=url.render_as_string(hide_password=False),
                      APP_SECRET=secrets.token_urlsafe(48), BUDGETLY_SEED_DEMO='false',
                      PGPASSFILE=os.devnull, PGSSLMODE='disable')


@contextmanager
def network_guard(host, port):
    originals = socket.socket.connect, socket.socket.connect_ex, socket.socketpair
    local = threading.local()

    def connect(sock, address):
        if getattr(local, 'pair', False) or address == (host, port):
            return originals[0](sock, address)
        raise RuntimeError('External sockets are disabled during PostgreSQL verification')

    def connect_ex(sock, address):
        if getattr(local, 'pair', False) or address == (host, port):
            return originals[1](sock, address)
        raise RuntimeError('External sockets are disabled during PostgreSQL verification')

    def pair(*args, **kwargs):
        local.pair = True
        try:
            return originals[2](*args, **kwargs)
        finally:
            local.pair = False

    socket.socket.connect, socket.socket.connect_ex, socket.socketpair = connect, connect_ex, pair
    try:
        yield
    finally:
        socket.socket.connect, socket.socket.connect_ex, socket.socketpair = originals


@contextmanager
def owned_schema(engine):
    """Only clean up the schema whose successful creation and OID we recorded."""
    schema = 'budgetly_verification_' + secrets.token_hex(16)
    oid = None
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql(f'CREATE SCHEMA "{schema}"')
            oid = connection.scalar(text('SELECT oid FROM pg_namespace WHERE nspname=:name'),
                                    {'name': schema})
        yield schema
    finally:
        if oid is not None:
            with engine.begin() as connection:
                current = connection.scalar(text('SELECT oid FROM pg_namespace WHERE nspname=:name'),
                                            {'name': schema})
                if current != oid:
                    raise RuntimeError('Schema identity changed; refusing cleanup')
                connection.exec_driver_sql(f'DROP SCHEMA "{schema}" CASCADE')


def concurrent_batch(operation, workers):
    barrier = threading.Barrier(workers, timeout=30)

    def invoke(index):
        barrier.wait()
        start = time.perf_counter()
        result = operation(index)
        return result, (time.perf_counter() - start) * 1000

    start = time.perf_counter()
    with ThreadPoolExecutor(max_workers=workers) as pool:
        pairs = list(pool.map(invoke, range(workers)))
    durations = sorted(pair[1] for pair in pairs)
    return [pair[0] for pair in pairs], {
        'workers': workers, 'elapsed_seconds': round(time.perf_counter() - start, 3),
        'min_ms': round(durations[0], 3), 'max_ms': round(durations[-1], 3),
    }


def require(condition, name):
    if not condition:
        raise VerificationFailure('Verification failed: ' + name)


def verify_ledger(engine, workers):
    from datetime import timedelta
    from fastapi import Depends
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session
    from api.app import app
    from api.database import Base, get_db
    from api.index import current_user
    from api.models import BankCandidate, BankMerchantMemory, PlannedTransaction, RequestReceipt, Transaction, User
    from api.planned import post_due
    from api.timekeeping import now

    Base.metadata.create_all(engine)
    with Session(engine) as db:
        owner = User(username='Synthetic', email='synthetic@example.test', password_hash='unused')
        db.add(owner)
        db.commit()
        owner_id = owner.id

    def database():
        with Session(engine) as db:
            yield db

    def authenticated(db=Depends(get_db)):
        return db.get(User, owner_id)

    overrides, ready = app.dependency_overrides.copy(), getattr(app.state, 'storage_ready', False)
    app.dependency_overrides[get_db] = database
    app.dependency_overrides[current_user] = authenticated
    app.state.storage_ready = True
    checks = []
    try:
        # No TestClient context: lifespan would run migrations, seed and background services.
        with_client = TestClient(app)
        def call(method, path, status=200, **kwargs):
            response = with_client.request(method, path, **kwargs)
            require(response.status_code == status, f'HTTP {method} {path}: {response.status_code}')
            return response.json()

        wallet = call('POST', '/api/wallets?space_id=personal', 201,
                      json={'name': 'Synthetic', 'initial_balance': '100.000'})['id']
        payload = {'wallet_id': wallet, 'type': 'expense', 'amount': '1.125',
                   'description': 'Synthetic', 'date': now().isoformat(), 'recurring_frequency': 'none'}

        def snapshot(count, balance, receipts):
            with Session(engine) as db:
                rows = db.query(Transaction).all()
                require(len(rows) == count, 'exact total transaction count')
                require(sum(row.is_opening_balance for row in rows) == 1, 'single opening entry')
                require(all(row.wallet_id == wallet and row.user_id == owner_id for row in rows), 'ledger ownership')
                actual = sum((row.amount if row.type == 'income' else -row.amount for row in rows), Decimal('0'))
                require(actual == balance, 'exact persisted decimal balance')
                require(db.query(RequestReceipt).count() == receipts, 'exact idempotency receipt count')
            visible = call('GET', f'/api/ledger/wallets/{wallet}?space_id=personal')
            require(Decimal(str(visible['balance'])) == balance, 'API balance matches persisted balance')

        def keyed(index, same):
            return call('POST', '/api/transactions?space_id=personal', 201, json=payload,
                        headers={'Idempotency-Key': 'same' if same else f'different-{index}'})

        results, timing = concurrent_batch(lambda i: keyed(i, True), workers)
        require(all(row == results[0] for row in results), 'same key returns identical response')
        balance = Decimal('98.875')
        snapshot(2, balance, 1)
        checks.append({'scenario': 'same_key', 'passed': True, **timing})

        results, timing = concurrent_batch(lambda i: keyed(i, False), workers)
        require(len({row['id'] for row in results}) == workers, 'different keys create distinct rows')
        balance -= Decimal('1.125') * workers
        snapshot(2 + workers, balance, 1 + workers)
        checks.append({'scenario': 'different_keys', 'passed': True, **timing})

        plans_count = workers * 2
        with Session(engine) as db:
            for index in range(plans_count):
                db.add(PlannedTransaction(owner_id=owner_id, created_by_id=owner_id,
                       wallet_id=wallet, type='expense', amount=Decimal('0.125'),
                       description=f'Synthetic plan {index}', due_at=now() - timedelta(days=1),
                       status='scheduled', reminder_enabled=False))
            db.commit()

        def worker(_):
            with Session(engine) as db:
                return post_due(db)

        results, timing = concurrent_batch(worker, workers)
        require(sum(results) == plans_count, 'workers collectively post each plan once')
        require(worker(0) == 0, 'post_due repeat has no work')
        with Session(engine) as db:
            plans = db.query(PlannedTransaction).all()
            linked = {row.posted_transaction_id for row in plans}
            require(len(plans) == plans_count and all(row.status == 'posted' for row in plans), 'all plans posted')
            require(None not in linked and len(linked) == plans_count, 'unique posted links')
            require(db.query(Transaction).filter(Transaction.id.in_(linked)).count() == plans_count, 'all posted links resolve')
        balance -= Decimal('0.125') * plans_count
        snapshot(2 + workers + plans_count, balance, 1 + workers)
        checks.append({'scenario': 'competing_post_due', 'passed': True, **timing})

        alert = {'content_hash': 'a' * 64, 'source_package': 'synthetic.bank',
                 'source_app': 'Synthetic', 'transaction_type': 'expense', 'amount': '6.750',
                 'currency': 'KWD', 'merchant': 'Synthetic', 'occurred_at': now().isoformat(),
                 'confidence': '0.95', 'reasons': ['Amount detected']}
        item = call('POST', '/api/bank-inbox/ingest?space_id=personal', 201, json=alert)['id']
        approval = {**payload, 'amount': '6.750', 'remember': True}
        path = f'/api/bank-inbox/{item}/approve?space_id=personal'
        results, timing = concurrent_batch(lambda _: call('POST', path, json=approval), workers)
        ids = {row['transaction_id'] for row in results}
        require(len(ids) == 1 and all(row['status'] == 'approved' for row in results), 'one bank approval transaction')
        require(call('POST', path, json=approval)['transaction_id'] in ids, 'bank replay stable')
        with Session(engine) as db:
            require(db.query(BankCandidate).count() == 1, 'one candidate')
            candidate = db.get(BankCandidate, item)
            require(candidate.status == 'approved' and candidate.transaction_id in ids, 'candidate persisted link')
            require(db.query(BankMerchantMemory).count() == 1, 'one merchant memory')
        balance -= Decimal('6.750')
        snapshot(3 + workers + plans_count, balance, 1 + workers)
        checks.append({'scenario': 'bank_approvals', 'passed': True, **timing})
        checks.extend(verify_security(engine, owner_id, workers))
        return {'schema_version': 1, 'passed': True, 'checks': checks,
                'isolation': 'unique owned schema / synthetic ASGI / loopback PostgreSQL'}
    finally:
        if 'with_client' in locals():
            with_client.close()
        app.dependency_overrides = overrides
        app.state.storage_ready = ready


def verify_security(engine, owner_id, workers):
    import hashlib
    from datetime import timedelta
    from fastapi import HTTPException
    from sqlalchemy.orm import Session
    from api.account_security import limit
    from api.index import verify_password
    from api.models import User, utc_now
    from api.reliability_models import AccountSession, Activity, RateBucket, ResetToken

    checks = []
    for expired in (False, True):
        key = 'synthetic-rate-' + str(expired)
        digest = hashlib.sha256(key.encode()).hexdigest()
        if expired:
            with Session(engine) as db:
                db.add(RateBucket(key=digest, count=99, started=utc_now() - timedelta(days=1)))
                db.commit()
        maximum = workers // 2
        def attempt(_):
            with Session(engine) as db:
                try:
                    limit(db, key, maximum=maximum, seconds=3600)
                    return 200
                except HTTPException as exc:
                    require(exc.status_code == 429, 'limiter only rejects excess attempts')
                    return 429
        results, timing = concurrent_batch(attempt, workers)
        require(results.count(200) == maximum and results.count(429) == workers - maximum,
                'exact rate allowance under concurrent contention')
        with Session(engine) as db:
            require(db.query(RateBucket).filter_by(key=digest).count() == 1, 'one rate bucket')
            require(db.get(RateBucket, digest).count == workers, 'rate counter includes every attempt')
        checks.append({'scenario': 'rate_limit_expired' if expired else 'rate_limit_new',
                       'passed': True, **timing})

    token = 'synthetic-reset-token-for-postgres-verification'
    digest = hashlib.sha256(token.encode()).hexdigest()
    with Session(engine) as db:
        db.add(ResetToken(user_id=owner_id, digest=digest, expires=utc_now() + timedelta(minutes=5)))
        db.add(AccountSession(id='synthetic-session', user_id=owner_id))
        db.commit()

    # Exercise the real unauthenticated reset API; no reset-request email is sent.
    from fastapi.testclient import TestClient
    from api.app import app
    client = TestClient(app)
    def reset(index):
        password = f'SyntheticPassword-{index}-123!'
        response = client.post('/api/auth/password-reset/complete', json={'token': token, 'password': password})
        require(response.status_code in {200, 400}, 'reset race returns only success or consumed token')
        return index, response.status_code
    try:
        results, timing = concurrent_batch(reset, workers)
        winners = [index for index, status in results if status == 200]
        require(len(winners) == 1, 'exactly one reset token winner')
        require(client.post('/api/auth/password-reset/complete', json={
            'token': token, 'password': 'SyntheticReplayPassword123!'}).status_code == 400, 'reset replay rejected')
        with Session(engine) as db:
            require(db.query(ResetToken).count() == 0, 'reset token consumed')
            require(db.get(AccountSession, 'synthetic-session').revoked, 'reset revokes session')
            require(db.query(Activity).filter_by(action='Password reset completed').count() == 1, 'one reset audit')
            stored = db.get(User, owner_id).password_hash
            require(verify_password(f'SyntheticPassword-{winners[0]}-123!', stored), 'winner password persisted')
            require(all(not verify_password(f'SyntheticPassword-{index}-123!', stored)
                        for index, status in results if status == 400), 'losers never replace password')
        checks.append({'scenario': 'password_reset_token_race', 'passed': True, **timing})
    finally:
        client.close()
    return checks


def checked_fixture(engine, workers, dburl, schema, before_cleanup=None):
    """Run all checks, then offer the live fixture to a trusted local callback."""
    evidence = verify_ledger(engine, workers)
    if before_cleanup is not None:
        before_cleanup(dburl, schema)
    return evidence


def run(value, workers=4, before_cleanup=None):
    """Fresh-process entrypoint; callback(dburl, schema) runs before owned cleanup."""
    url = validate_url(value)
    if not 2 <= workers <= 16:
        raise ValueError('workers must be 2..16')
    if any(name == 'api' or name.startswith('api.') for name in sys.modules):
        raise RuntimeError('Run in a fresh process before importing api')
    isolated_environment(url)
    with network_guard(url.host, url.port):
        admin = create_engine(url, connect_args={'connect_timeout': 5,
                              'options': '-cstatement_timeout=15000 -clock_timeout=10000'})
        try:
            with owned_schema(admin) as schema:
                scoped_url = url.update_query_dict({'options': f'-csearch_path={schema} -cstatement_timeout=15000 -clock_timeout=10000'})
                os.environ['FLOWBUDGET_DATABASE_URL'] = scoped_url.render_as_string(hide_password=False)
                from api.database import engine
                try:
                    with engine.connect() as connection:
                        require(connection.scalar(text('SELECT current_schema()')) == schema, 'isolated search path')
                    return checked_fixture(engine, workers, scoped_url.render_as_string(hide_password=False),
                                           schema, before_cleanup)
                finally:
                    engine.dispose()
        finally:
            admin.dispose()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', required=True, help='Explicit disposable loopback PostgreSQL URL')
    parser.add_argument('--workers', type=int, default=4)
    parser.add_argument('--output', type=Path, help='New anonymized JSON evidence file')
    args = parser.parse_args()
    try:
        validate_url(args.url)
    except ValueError as exc:
        parser.error(str(exc))
    if not 2 <= args.workers <= 16:
        parser.error('workers must be 2..16')
    if args.output and args.output.exists():
        parser.error('Output already exists')
    try:
        evidence = run(args.url, args.workers)
    except Exception as exc:
        # Drivers and API exceptions can embed connection details; never print those.
        print(json.dumps({'schema_version': 1, 'passed': False,
                          'error': str(exc) if isinstance(exc, VerificationFailure) else
                          'Verification failed; inspect locally without publishing connection details'}))
        return 1
    if args.output:
        with args.output.open('x', encoding='utf-8') as output:
            json.dump(evidence, output, indent=2)
    print(json.dumps(evidence, indent=2))
    return 0


if __name__ == '__main__':
    sys.exit(main())
