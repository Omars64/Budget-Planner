"""Opt-in isolated synthetic PostgreSQL load verification; run as a fresh process."""
import argparse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timedelta
from decimal import Decimal
import json
import logging
import math
import os
from pathlib import Path
import platform
import sys
import threading
import time
import warnings

from sqlalchemy import create_engine, event, text
from sqlalchemy.exc import TimeoutError as PoolTimeout

from scripts.verify_postgres import (
    VerificationFailure, isolated_environment, network_guard, owned_schema, require,
    validate_url as postgres_url,
)


def validate_url(value):
    url = postgres_url(value)
    if url.port != 55432 or url.database != 'budgetly_verification_load':
        raise ValueError('Require port 55432 and dedicated budgetly_verification_load database')
    return url


def validate_workload(duration, workers, records, smoke=False):
    if not isinstance(duration, (int, float)) or not math.isfinite(duration):
        raise ValueError('duration must be finite')
    if smoke:
        if not 1 <= duration <= 5 or workers != 2 or records != 20:
            raise ValueError('smoke requires duration 1..5, workers 2, records 20')
    elif not 1 <= duration <= 300 or workers not in (16, 32) or not 1000 <= records <= 10000:
        raise ValueError('require duration 1..300, workers 16 or 32, records 1000..10000')
    if type(workers) is not int or type(records) is not int:
        raise ValueError('workers and records must be integers')


def summarize(samples, elapsed):
    result = {}
    for name, values in sorted(samples.items()):
        latencies = sorted(row[0] for row in values)
        failures = sum(not row[1] for row in values)
        result[name] = {
            'requests': len(values), 'errors': failures,
            'error_rate': failures / len(values),
            'p50_ms': round(latencies[math.ceil(len(values) * .50) - 1], 3),
            'p95_ms': round(latencies[math.ceil(len(values) * .95) - 1], 3),
            'throughput_rps': round(len(values) / elapsed, 3),
            'statuses': dict(Counter(str(row[2]) for row in values)),
        }
    return result


@contextmanager
def aggregate_output():
    """Prevent application diagnostics from emitting individual request evidence."""
    previous = logging.root.manager.disable
    logging.disable(logging.CRITICAL)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('ignore')
            yield
    finally:
        logging.disable(previous)


class ErrorDiagnostics:
    """Only fixed categories and counts escape; SQL and exception text are never retained."""
    DATABASE_CODES = {
        '23505': 'expected_unique_conflict',
        '55P03': 'postgres_lock_unavailable', '40P01': 'postgres_deadlock',
        '57014': 'postgres_query_cancelled', '40001': 'postgres_serialization_failure',
        '08000': 'postgres_connection_failure', '08003': 'postgres_connection_failure',
        '08006': 'postgres_connection_failure', '53300': 'postgres_connection_limit',
    }
    CONFLICT_CODES = {
        'Workspace is changing. Retry this request.': 'owner_lock_unavailable',
        'Workspace changed. Refresh and try again.': 'workspace_changed',
        'This request identifier was already used for different data': 'idempotency_payload_conflict',
        'Wallet ownership changed. Refresh and try again.': 'wallet_ownership_changed',
        'Wallet changed. Refresh and try again.': 'wallet_changed',
    }

    def __init__(self, engine):
        self.phase = 'setup'
        self.counts = defaultdict(Counter)
        self.lock = threading.Lock()
        pool = engine.pool
        self.pool = {'class': type(pool).__name__, 'size': pool.size(),
                     'max_overflow': getattr(pool, '_max_overflow', None),
                     'checkout_timeout_seconds': pool.timeout()}

    def record(self, code):
        with self.lock:
            self.counts[self.phase][code] += 1

    def database_error(self, context):
        original = context.original_exception
        self.record(self.DATABASE_CODES.get(getattr(original, 'sqlstate', None), 'other_database_error'))

    def response_error(self, response):
        code = 'unclassified_http_error'
        if response.status_code == 409:
            code = 'unclassified_conflict'
            try:
                body = response.json()
                detail = body.get('detail') if isinstance(body, dict) else None
                if isinstance(detail, str):
                    code = self.CONFLICT_CODES.get(detail, code)
            except Exception:
                pass
        self.record(code)

    def evidence(self):
        with self.lock:
            return {'pool': self.pool.copy(),
                    'observations_by_phase': {phase: dict(counts) for phase, counts in self.counts.items()}}


@contextmanager
def error_diagnostics(engine, enabled):
    """Observe the same pool, including middleware sessions, without altering its limits."""
    if not enabled:
        yield None
        return
    diagnostics = ErrorDiagnostics(engine)
    pool = engine.pool
    original = pool.connect
    previous = pool.__dict__.get('connect')
    had_override = 'connect' in pool.__dict__

    def connect(*args, **kwargs):
        try:
            return original(*args, **kwargs)
        except PoolTimeout:
            diagnostics.record('pool_checkout_timeout')
            raise

    event.listen(engine, 'handle_error', diagnostics.database_error)
    pool.connect = connect
    try:
        yield diagnostics
    finally:
        if had_override:
            pool.connect = previous
        else:
            del pool.connect
        event.remove(engine, 'handle_error', diagnostics.database_error)


def check_shape(name, body, wallets, categories):
    def transaction(row):
        require(isinstance(row, dict) and {'id', 'type', 'amount', 'wallet_id',
                'reporting_month', 'date', 'revision', 'is_opening_balance'} <= row.keys(),
                'transaction response shape')
        require(type(row['id']) is int and row['wallet_id'] in wallets and
                row.get('transfer_wallet_id') in [None, *wallets] and
                row.get('category_id') in [None, *categories] and
                row['type'] in {'income', 'expense', 'transfer'} and
                Decimal(str(row['amount'])) > 0, 'transaction values and account isolation')

    if name in {'write', 'replay'}:
        transaction(body)
    elif name == 'list':
        require(isinstance(body, list) and 0 < len(body) <= 50, 'bounded list shape')
        for row in body:
            transaction(row)
    elif name == 'dashboard':
        require(isinstance(body, dict) and {'total_balance', 'income', 'expense', 'month',
                'wallets', 'cashflow', 'weekly', 'recent_transactions', 'category_spending',
                'budgets', 'shared'} <= body.keys(), 'dashboard shape')
        require({row['id'] for row in body['wallets']} == set(wallets), 'dashboard isolation')
        for field in ('total_balance', 'income', 'expense'):
            require(math.isfinite(float(body[field])), 'finite dashboard totals')
        require(isinstance(body['cashflow'], list) and isinstance(body['weekly'], dict) and
                len(body['recent_transactions']) <= 5, 'dashboard nested shape')
        for row in body['recent_transactions']:
            transaction(row)
    elif name == 'analytics':
        require(isinstance(body, dict) and isinstance(body.get('trend'), list) and
                len(body['trend']) == 6 and isinstance(body.get('categories'), list), 'analytics shape')
        for row in body['trend']:
            require({'month', 'month_key', 'income', 'expense'} <= row.keys() and
                    all(math.isfinite(float(row[k])) for k in ('income', 'expense')), 'trend shape')
        for row in body['categories']:
            require({'id', 'name', 'value', 'color'} <= row.keys() and
                    row['id'] in [0, *categories], 'analytics category isolation')


def seed(engine, accounts, records):
    from sqlalchemy.orm import Session
    from api.database import Base
    from api.models import Category, Transaction, User, Wallet
    from api.timekeeping import now

    Base.metadata.create_all(engine)
    fixtures = []
    current = now()
    with Session(engine) as db:
        for index in range(accounts):
            user = User(username='Synthetic load', email=f'load-{index}@example.test', password_hash='unused')
            db.add(user)
            db.flush()
            wallets = [Wallet(user_id=user.id, name=f'Synthetic wallet {i}', initial_balance=0)
                       for i in range(3)]
            categories = [Category(user_id=user.id, name=f'Synthetic category {i}',
                                   kind='income' if i == 0 else 'expense') for i in range(6)]
            db.add_all(wallets + categories)
            db.flush()
            balances = {w.id: Decimal('1000.000') for w in wallets}
            rows = [dict(user_id=user.id, wallet_id=w.id, type='income', amount=Decimal('1000.000'),
                         description='Synthetic opening', date=current, reporting_month=current.strftime('%Y-%m'),
                         is_opening_balance=True, transfer_wallet_id=None, category_id=None) for w in wallets]
            for n in range(records):
                offset = n % 6
                month = current.year * 12 + current.month - 1 - offset
                dated = datetime(month // 12, month % 12 + 1, 1) + timedelta(days=n % 28, hours=n % 24)
                source = wallets[n % 3].id
                kind = 'transfer' if n % 10 == 0 else 'income' if n % 5 == 0 else 'expense'
                amount = Decimal(125 + n % 5000) / 1000
                destination = wallets[(n + 1) % 3].id if kind == 'transfer' else None
                category = None if kind == 'transfer' else categories[0 if kind == 'income' else 1 + n % 5].id
                rows.append(dict(user_id=user.id, wallet_id=source, transfer_wallet_id=destination,
                                 category_id=category, type=kind, amount=amount, date=dated,
                                 reporting_month=dated.strftime('%Y-%m'), is_opening_balance=False,
                                 description=f'Synthetic record {n}'))
                balances[source] += amount if kind == 'income' else -amount
                if destination:
                    balances[destination] += amount
            db.execute(Transaction.__table__.insert(), rows)
            fixtures.append(dict(user=user.id, wallets=[w.id for w in wallets],
                                 categories=[c.id for c in categories], balances=balances))
        db.commit()
    return fixtures, current


def exercise(engine, duration, workers, records, smoke, diagnostics=None):
    from fastapi import Depends, Request
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session
    from api.app import app
    from api.database import get_db
    from api.index import current_user
    from api.models import RequestReceipt, Transaction, User

    fixtures, dated = seed(engine, 2 if smoke else 20, records)
    identities = {str(f['user']): f['user'] for f in fixtures}

    def database():
        with Session(engine) as db:
            yield db

    def authenticated(request: Request, db=Depends(get_db)):
        require(request.headers.get('X-Synthetic-Account') in identities, 'synthetic identity required')
        return db.get(User, identities[request.headers['X-Synthetic-Account']])

    overrides = app.dependency_overrides.copy()
    ready = getattr(app.state, 'storage_ready', False)
    app.dependency_overrides[get_db] = database
    app.dependency_overrides[current_user] = authenticated
    app.state.storage_ready = True
    attempts, samples = {}, defaultdict(list)
    lock = threading.Lock()

    def payload(f):
        return dict(wallet_id=f['wallets'][0], category_id=f['categories'][1], type='expense',
                    amount='1.125', description='Synthetic load write', date=dated.isoformat(),
                    recurring_frequency='none')

    def call(client, f, name, key=None, measured=False):
        paths = {'dashboard': '/api/dashboard', 'list': '/api/transactions',
                 'analytics': '/api/analytics', 'write': '/api/transactions', 'replay': '/api/transactions'}
        headers = {'X-Synthetic-Account': str(f['user'])}
        params = {'space_id': 'personal'}
        kwargs = {}
        writing = name in {'write', 'replay'}
        if writing:
            headers['Idempotency-Key'] = key
            kwargs['json'] = payload(f)
            with lock:
                attempts.setdefault((f['user'], key), None)
        elif name == 'list':
            params.update(limit=50, scope='personal', tx_type='expense', search='Synthetic')
        elif name == 'analytics':
            params['months'] = 6
        status, success = 'exception', False
        started = time.perf_counter()
        try:
            response = client.request('POST' if writing else 'GET', paths[name],
                                      headers=headers, params=params, **kwargs)
            status = response.status_code
            if diagnostics is not None and status != (201 if writing else 200):
                diagnostics.response_error(response)
            require(status == (201 if writing else 200), 'load HTTP status')
            body = response.json()
            check_shape(name, body, f['wallets'], f['categories'])
            if writing:
                require(body['type'] == 'expense' and Decimal(str(body['amount'])) == Decimal('1.125')
                        and body['wallet_id'] == f['wallets'][0], 'write payload preserved')
                with lock:
                    previous = attempts[(f['user'], key)]
                    require(previous is None or previous == body['id'], 'replay identity stable')
                    attempts[(f['user'], key)] = body['id']
            success = True
            return body
        finally:
            if measured:
                with lock:
                    samples[name].append(((time.perf_counter() - started) * 1000, success, status))

    def worker(index, barrier, timing):
        client = TestClient(app, raise_server_exceptions=False)
        sequence = 0
        schedule = ['dashboard', 'list', 'analytics', 'list', 'dashboard',
                    'analytics', 'list', 'dashboard', 'write', 'replay']
        try:
            barrier.wait(timeout=30)
            while time.perf_counter() < timing['deadline']:
                name = schedule[sequence % 10]
                # The replay uses the same account and payload as the preceding write.
                cycle = sequence // 10
                f = fixtures[(index + cycle) % len(fixtures)]
                key = f'load-{index}-{cycle}' if name in {'write', 'replay'} else None
                try:
                    call(client, f, name, key, measured=True)
                except Exception:
                    # Keep exercising the workload; report numeric errors, never response text.
                    pass
                sequence += 1
        finally:
            client.close()

    client = TestClient(app, raise_server_exceptions=False)
    try:
        # No TestClient context: lifespan runs migrations, seeds and integrations.
        for f in fixtures:
            for name in ('dashboard', 'list', 'analytics'):
                call(client, f, name)

        def contention(_):
            local_client = TestClient(app, raise_server_exceptions=False)
            try:
                rendezvous.wait(timeout=30)
                return call(local_client, fixtures[0], 'write', 'load-contention')
            finally:
                local_client.close()

        rendezvous = threading.Barrier(workers)
        with ThreadPoolExecutor(max_workers=workers) as pool:
            results = list(pool.map(contention, range(workers)))
        require(all(row == results[0] for row in results), 'concurrent replay identical response')
        timing = {}

        def start():
            if diagnostics is not None:
                diagnostics.phase = 'measured'
            timing['start'] = time.perf_counter()
            timing['deadline'] = timing['start'] + duration

        barrier = threading.Barrier(workers, action=start)
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = [pool.submit(worker, i, barrier, timing) for i in range(workers)]
            for future in futures:
                future.result()
        elapsed = time.perf_counter() - timing['start']
        if diagnostics is not None:
            diagnostics.phase = 'verification'
        metrics = summarize(samples, elapsed)
        all_samples = [row for rows in samples.values() for row in rows]
        overall = summarize({'overall': all_samples}, elapsed)['overall']
        correctness = True
        try:
            require(set(metrics) == {'dashboard', 'list', 'analytics', 'write', 'replay'},
                    'every workload route exercised')
            require(all(value is not None for value in attempts.values()), 'every attempted write reconciled')
            with Session(engine) as db:
                receipts = db.query(RequestReceipt).all()
                require(len(receipts) == len(attempts), 'exact unique receipt count')
                ids = list(attempts.values())
                require(len(ids) == len(set(ids)), 'distinct keys have distinct transactions')
                for receipt in receipts:
                    require(receipt.scope == 'transaction' and
                            json.loads(receipt.response)['id'] == attempts[(receipt.user_id, receipt.key)],
                            'receipt resolves to expected transaction')
                for f in fixtures:
                    rows = db.query(Transaction).filter_by(user_id=f['user']).all()
                    writes = {value for (owner, _), value in attempts.items() if owner == f['user']}
                    require(len(rows) == records + 3 + len(writes), 'exact per-account ledger count')
                    require(sum(row.is_opening_balance for row in rows) == 3, 'single opening per wallet')
                    require({row.id for row in rows if row.id in writes} == writes, 'persisted write identities')
                    expected = f['balances'].copy()
                    expected[f['wallets'][0]] -= Decimal('1.125') * len(writes)
                    actual = {wallet: Decimal(0) for wallet in f['wallets']}
                    monthly = defaultdict(lambda: {'income': Decimal(0), 'expense': Decimal(0)})
                    for row in rows:
                        require(row.wallet_id in actual and row.category_id in [None, *f['categories']],
                                'persisted account isolation')
                        actual[row.wallet_id] += row.amount if row.type == 'income' else -row.amount
                        if row.type == 'transfer':
                            require(row.transfer_wallet_id in actual, 'transfer destination isolation')
                            actual[row.transfer_wallet_id] += row.amount
                        elif row.type == 'income' or not row.is_opening_balance:
                            monthly[row.reporting_month][row.type] += row.amount
                    require(actual == expected, 'exact decimal balances including transfers')
                    dashboard = call(client, f, 'dashboard')
                    require(Decimal(str(dashboard['total_balance'])) == sum(expected.values()), 'API total balance')
                    require(all(Decimal(str(w['balance'])) == expected[w['id']] for w in dashboard['wallets']),
                            'API individual wallet balances')
                    for field in ('income', 'expense'):
                        require(Decimal(str(dashboard[field])) == monthly[dashboard['month']][field],
                                'dashboard monthly totals')
                    analytics = call(client, f, 'analytics')
                    for trend in analytics['trend']:
                        for field in ('income', 'expense'):
                            require(Decimal(str(trend[field])) == monthly[trend['month_key']][field],
                                    'analytics monthly totals')
        except Exception:
            correctness = False
        return {
            'schema_version': 1, 'passed': correctness and overall['errors'] == 0,
            'correctness_passed': correctness, 'profile': 'smoke' if smoke else 'realistic',
            'workload': {'accounts': len(fixtures), 'records_per_account': records,
                         'opening_records_per_account': 3, 'wallets_per_account': 3,
                         'categories_per_account': 6, 'history_months': 6, 'workers': workers,
                         'requested_seconds': duration, 'elapsed_seconds': round(elapsed, 3),
                         'mix_per_10_requests': {'dashboard': 3, 'list': 3, 'analytics': 2, 'write': 1, 'replay': 1},
                         'unique_writes_including_preflight': len(attempts)},
            'overall': overall, 'routes': metrics,
            'hardware': {'os': platform.system(), 'architecture': platform.machine(),
                         'logical_cpus': os.cpu_count(), 'python': platform.python_version()},
            'isolation': 'owned schema / synthetic ASGI / loopback PostgreSQL / no lifespan',
        }
    finally:
        client.close()
        app.dependency_overrides = overrides
        app.state.storage_ready = ready


def run(value, duration=30, workers=16, records=1000, smoke=False, diagnose_errors=False):
    url = validate_url(value)
    validate_workload(duration, workers, records, smoke)
    if any(name == 'api' or name.startswith('api.') for name in sys.modules):
        raise RuntimeError('Run in a fresh process before importing api')
    isolated_environment(url)
    with network_guard(url.host, url.port), aggregate_output():
        admin = create_engine(url, connect_args={'connect_timeout': 5,
                              'options': '-cstatement_timeout=15000 -clock_timeout=10000'})
        try:
            with owned_schema(admin) as schema:
                scoped = url.update_query_dict({'options': f'-csearch_path={schema} -cstatement_timeout=15000 -clock_timeout=10000'})
                os.environ['FLOWBUDGET_DATABASE_URL'] = scoped.render_as_string(hide_password=False)
                from api.database import engine
                try:
                    with engine.connect() as connection:
                        require(connection.scalar(text('SELECT current_schema()')) == schema, 'isolated search path')
                    with error_diagnostics(engine, diagnose_errors) as diagnostics:
                        evidence = exercise(engine, duration, workers, records, smoke, diagnostics)
                    if diagnostics is not None:
                        evidence['error_diagnostics'] = diagnostics.evidence()
                    with engine.connect() as connection:
                        evidence['postgres_version'] = connection.scalar(text('SHOW server_version'))
                    return evidence
                finally:
                    engine.dispose()
        finally:
            admin.dispose()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', required=True, help='Explicit disposable loopback PostgreSQL URL')
    parser.add_argument('--smoke', action='store_true', help='Two accounts, 20 records, two workers')
    parser.add_argument('--duration', type=float)
    parser.add_argument('--workers', type=int)
    parser.add_argument('--records', type=int)
    parser.add_argument('--output', type=Path, help='New aggregate-only JSON evidence file')
    parser.add_argument('--diagnose-errors', action='store_true',
                        help='Aggregate sanitized pool/SQLSTATE/conflict error categories')
    args = parser.parse_args()
    duration = args.duration if args.duration is not None else (2 if args.smoke else 30)
    workers = args.workers if args.workers is not None else (2 if args.smoke else 16)
    records = args.records if args.records is not None else (20 if args.smoke else 1000)
    try:
        validate_url(args.url)
        validate_workload(duration, workers, records, args.smoke)
    except ValueError as exc:
        parser.error(str(exc))
    if args.output and args.output.exists():
        parser.error('Output already exists')
    try:
        evidence = run(args.url, duration, workers, records, args.smoke, args.diagnose_errors)
    except Exception:
        evidence = {'schema_version': 1, 'passed': False,
                    'error': 'Load verification failed; inspect locally without publishing connection details'}
    if args.output:
        with args.output.open('x', encoding='utf-8') as output:
            json.dump(evidence, output, indent=2)
    print(json.dumps(evidence, indent=2))
    return 0 if evidence['passed'] else 1


if __name__ == '__main__':
    sys.exit(main())
