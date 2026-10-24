"""Bootstrap safety with fake storage and a controlled clock; no database I/O."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import threading
from types import SimpleNamespace
from unittest.mock import Mock
import asyncio

import pytest
from fastapi import FastAPI, Request

import api.index as core
import api.passkeys as passkeys
import api.schema_migrations as migrations


@pytest.fixture
def bootstrap(monkeypatch):
    application = FastAPI()
    application.state.storage_ready = False
    application.state.storage_retry_at = 0
    clock = SimpleNamespace(now=100.0)
    monkeypatch.setattr(core, 'app', application)
    monkeypatch.setattr(core, '_storage_lock', threading.Lock())
    monkeypatch.setattr(core, 'time', SimpleNamespace(monotonic=lambda: clock.now))
    monkeypatch.setattr(core, 'engine', Mock(begin=Mock(
        side_effect=AssertionError('Bootstrap test attempted database access'))))
    return application, clock


def test_concurrent_bootstrap_initializes_once_after_success(bootstrap, monkeypatch):
    application, _ = bootstrap
    workers = 8
    start = threading.Barrier(workers + 1)
    entered = threading.Event()
    finish = threading.Event()

    def initialize(app):
        assert app is application
        entered.set()
        assert finish.wait(5), 'Test did not release initialization'
        app.state.storage_ready = True
        return True

    initialize = Mock(side_effect=initialize)
    monkeypatch.setattr(core, '_initialize_storage', initialize)

    def attempt():
        start.wait(timeout=5)
        return core.initialize_storage(application)

    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = [executor.submit(attempt) for _ in range(workers)]
        try:
            start.wait(timeout=5)
            assert entered.wait(5)
            assert application.state.storage_ready is False
            assert not any(future.done() for future in futures)
        finally:
            finish.set()
        assert [future.result(timeout=5) for future in futures] == [True] * workers

    initialize.assert_called_once_with(application)
    assert application.state.storage_ready is True
    assert application.state.storage_retry_at == 0
    assert core.initialize_storage(application) is True
    initialize.assert_called_once()


def test_failure_cooldown_retries_at_boundary_and_releases_lock(bootstrap, monkeypatch):
    application, clock = bootstrap

    def initialize(app):
        if initialize.call_count == 1:
            # Cooldown starts when the failed attempt finishes.
            clock.now = 102.0
            return False
        app.state.storage_ready = True
        return True

    initialize = Mock(side_effect=initialize)
    monkeypatch.setattr(core, '_initialize_storage', initialize)

    assert core.initialize_storage(application) is False
    assert application.state.storage_ready is False
    assert application.state.storage_retry_at == 107.0
    assert core._storage_lock.acquire(blocking=False)
    core._storage_lock.release()

    for now in (102.0, 106.999):
        clock.now = now
        assert core.initialize_storage(application) is False
        initialize.assert_called_once_with(application)
        assert application.state.storage_ready is False

    clock.now = 107.0
    assert core.initialize_storage(application) is True
    assert initialize.call_count == 2
    assert application.state.storage_ready is True
    assert application.state.storage_retry_at == 0
    assert core._storage_lock.acquire(blocking=False)
    core._storage_lock.release()


def test_unexpected_bootstrap_exception_releases_lock(bootstrap, monkeypatch):
    application, _ = bootstrap
    initialize = Mock(side_effect=RuntimeError('Synthetic unexpected failure'))
    monkeypatch.setattr(core, '_initialize_storage', initialize)

    with pytest.raises(RuntimeError, match='Synthetic unexpected failure'):
        core.initialize_storage(application)

    assert application.state.storage_ready is False
    assert core._storage_lock.acquire(blocking=False)
    core._storage_lock.release()


@pytest.mark.parametrize('phase', ['uninitialized', 'failed', 'cooldown'])
def test_handlers_reject_storage_that_is_not_ready(bootstrap, monkeypatch, phase):
    application, _ = bootstrap
    initialize = Mock(return_value=False)
    monkeypatch.setattr(core, '_initialize_storage', initialize)
    if phase != 'uninitialized':
        assert core.initialize_storage(application) is False
    if phase == 'cooldown':
        assert core.initialize_storage(application) is False
        initialize.assert_called_once()

    handler = Mock(side_effect=AssertionError('Unavailable storage reached handler'))
    request = Request({'type': 'http', 'method': 'GET', 'path': '/api/wallets',
                       'headers': [], 'app': application})
    response = asyncio.run(core.storage_readiness(request, handler))

    assert response.status_code == 503
    assert b'STORAGE_UNAVAILABLE' in response.body
    assert response.headers['cache-control'] == 'no-store'
    assert int(response.headers['retry-after']) > 0
    assert application.state.storage_ready is False
    handler.assert_not_called()


@pytest.mark.parametrize('failure', [None, 'schema', 'seed', 'migrate', 'session_commit', 'commit'])
def test_bootstrap_transaction_commits_before_marking_ready(bootstrap, monkeypatch, failure):
    application, _ = bootstrap
    events = []
    connection = SimpleNamespace(dialect=SimpleNamespace(name='postgresql'))

    def step(name):
        assert application.state.storage_ready is False
        events.append(name)
        if failure == name:
            raise RuntimeError('Synthetic transaction failure')

    connection.execute = Mock(side_effect=lambda statement: step('advisory_lock'))

    @contextmanager
    def transaction():
        step('begin')
        try:
            yield connection
            step('commit')
        except Exception:
            events.append('rollback')
            raise

    @contextmanager
    def session(*, bind):
        assert bind is connection
        step('session')
        try:
            yield db
        finally:
            step('session_exit')

    db = SimpleNamespace(commit=lambda: step('session_commit'))
    monkeypatch.delenv('VERCEL', raising=False)
    monkeypatch.setattr(core, 'IS_EPHEMERAL_VERCEL_SQLITE', False)
    monkeypatch.setattr(core, 'engine', SimpleNamespace(begin=transaction))
    monkeypatch.setattr(core, 'Session', session)

    def schema(bind, ensure_columns):
        assert bind is connection
        assert ensure_columns is core.ensure_note_columns
        step('schema')

    def seed(bind, *, include_demo, commit):
        assert bind is db
        assert include_demo is False
        assert commit is False
        step('seed')

    def migrate(bind):
        assert bind is db
        step('migrate')

    def indexes(bind):
        assert bind is connection
        step('indexes')

    def migrate_passkeys(bind):
        assert bind is db
        step('passkeys')

    monkeypatch.setattr(migrations, 'apply_migrations', schema)
    monkeypatch.setattr(core, 'ensure_indexes', indexes)
    monkeypatch.setattr(core, 'demo_seed_enabled', lambda: False)
    monkeypatch.setattr(core, 'seed_database', seed)
    monkeypatch.setattr(core, 'migrate_opening_balances', migrate)
    monkeypatch.setattr(passkeys, 'migrate_passkeys', migrate_passkeys)

    assert core._initialize_storage(application) is (failure is None)
    assert application.state.storage_ready is (failure is None)
    connection.execute.assert_called_once()
    statement = str(connection.execute.call_args.args[0])
    assert statement == 'SELECT pg_advisory_xact_lock(61420731)'
    if failure is None:
        assert events == ['begin', 'advisory_lock', 'schema', 'indexes', 'session',
                          'seed', 'migrate', 'passkeys', 'session_commit',
                          'session_exit', 'commit']
    else:
        assert events[-1] == 'rollback'
        assert failure in events
        if failure != 'commit':
            assert 'commit' not in events
