"""Safety and orchestration tests; these never need a PostgreSQL server or API imports."""
from contextlib import contextmanager
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import threading

import pytest

from scripts import verify_postgres as verifier

ROOT = Path(__file__).resolve().parents[1]
LOCAL = 'postgresql+psycopg://postgres@127.0.0.1:55432/budgetly_verification_rehearsal'


@pytest.mark.parametrize('url', [LOCAL, LOCAL.replace('127.0.0.1', '[::1]'),
                               LOCAL.replace('+psycopg', '')])
def test_explicit_loopback_trust_urls(url):
    parsed = verifier.validate_url(url)
    assert parsed.drivername == 'postgresql+psycopg'
    assert parsed.password is None


@pytest.mark.parametrize('url', ['', 'postgresql://postgres/budgetly_verification_test',
    LOCAL.replace('127.0.0.1', 'localhost'), LOCAL.replace('127.0.0.1', '192.168.1.2'),
    LOCAL.replace(':55432', ''), LOCAL.replace(':55432', ':0'),
    LOCAL.replace('budgetly_verification_rehearsal', 'postgres'),
    LOCAL.replace('budgetly_verification_rehearsal', 'budgetly_verification_'),
    LOCAL.replace('budgetly_verification_rehearsal', 'budgetly_verification_x%22'),
    LOCAL.replace('postgres@', ''), LOCAL.replace('+psycopg', '+psycopg2'),
    LOCAL + '?host=remote.test', LOCAL + '?service=production',
    LOCAL + '?options=-csearch_path=public', LOCAL + '?sslmode=require',
    'sqlite:///flowbudget.db'])
def test_refuse_ambiguous_or_rerouted_connections(url):
    with pytest.raises(ValueError, match='explicit PostgreSQL URL'):
        verifier.validate_url(url)


def test_environment_drops_database_aliases_credentials_and_libpq_settings(monkeypatch):
    # Snapshot the whole environment because the helper intentionally clears it.
    monkeypatch.setattr(os, 'environ', {'PATH': 'tools', 'DATABASE_URL': 'remote',
        'FLOWBUDGET_POSTGRES_URL': 'remote', 'PGSERVICE': 'prod', 'PGHOST': 'remote',
        'PGOPTIONS': '-csearch_path=public', 'PGPASSWORD': 'secret',
        'BACKUP_S3_BUCKET': 'prod', 'UPDATE_PUSH_ENCRYPTION_KEY': 'secret',
        'ADMIN_INITIAL_EMAIL': 'real@example.test', 'VERCEL': '1', 'SMTP_PASSWORD': 'secret'})
    verifier.isolated_environment(verifier.validate_url(LOCAL))
    assert set(os.environ) == {'PATH', 'FLOWBUDGET_DATABASE_URL', 'APP_SECRET', 'BUDGETLY_SEED_DEMO',
                               'PGPASSFILE', 'PGSSLMODE'}
    assert os.environ['FLOWBUDGET_DATABASE_URL'] == LOCAL
    assert os.environ['BUDGETLY_SEED_DEMO'] == 'false'
    assert os.environ['PGPASSFILE'] == os.devnull
    assert os.environ['PGSSLMODE'] == 'disable'


class Connection:
    def __init__(self, oids, fail_create=False):
        self.oids = iter(oids)
        self.statements = []
        self.fail_create = fail_create

    def exec_driver_sql(self, sql):
        self.statements.append(sql)
        if self.fail_create and sql.startswith('CREATE'):
            raise RuntimeError('collision')

    def scalar(self, sql, params):
        assert params['name'].startswith('budgetly_verification_')
        return next(self.oids)


class Engine:
    def __init__(self, connection):
        self.connection = connection

    @contextmanager
    def begin(self):
        yield self.connection


def test_owned_schema_cleanup_on_scenario_failure():
    connection = Connection([71, 71])
    with pytest.raises(ValueError, match='scenario'):
        with verifier.owned_schema(Engine(connection)) as name:
            assert len(name) < 63
            raise ValueError('scenario')
    assert connection.statements == [f'CREATE SCHEMA "{name}"', f'DROP SCHEMA "{name}" CASCADE']


@pytest.mark.parametrize('current', [None, 72])
def test_schema_replacement_is_never_dropped(current):
    connection = Connection([71, current])
    with pytest.raises(RuntimeError, match='identity changed'):
        with verifier.owned_schema(Engine(connection)):
            pass
    assert len(connection.statements) == 1


def test_failed_creation_never_drops_collision():
    connection = Connection([], fail_create=True)
    with pytest.raises(RuntimeError, match='collision'):
        with verifier.owned_schema(Engine(connection)):
            pytest.fail('must not enter')
    assert len(connection.statements) == 1


def test_batch_uses_simultaneous_independent_workers():
    rendezvous = threading.Barrier(4, timeout=5)
    def operation(index):
        rendezvous.wait()
        return index, threading.get_ident()
    results, timing = verifier.concurrent_batch(operation, 4)
    assert [row[0] for row in results] == list(range(4))
    assert len({row[1] for row in results}) == 4
    assert timing['workers'] == 4
    assert 0 <= timing['min_ms'] <= timing['max_ms']


def test_batch_propagates_failure():
    def operation(index):
        verifier.require(index != 1, 'synthetic assertion')
    with pytest.raises(verifier.VerificationFailure, match='synthetic assertion'):
        verifier.concurrent_batch(operation, 2)


def test_network_guard_refuses_external_and_restores_after_failure():
    before = socket.socket.connect, socket.socket.connect_ex, socket.socketpair
    with pytest.raises(RuntimeError, match='External sockets'):
        with verifier.network_guard('127.0.0.1', 55432):
            with socket.socket() as sock:
                sock.connect(('example.test', 443))
    assert (socket.socket.connect, socket.socket.connect_ex, socket.socketpair) == before


def test_network_guard_allows_internal_socketpair():
    with verifier.network_guard('127.0.0.1', 55432):
        left, right = socket.socketpair()
        try:
            left.send(b'x')
            assert right.recv(1) == b'x'
        finally:
            left.close()
            right.close()


@pytest.mark.parametrize('arguments', [[], ['--url', LOCAL + '?host=remote'],
                                    ['--url', LOCAL, '--workers', '1']])
def test_cli_refuses_without_connecting(arguments):
    result = subprocess.run([sys.executable, '-m', 'scripts.verify_postgres', *arguments],
                            cwd=ROOT, capture_output=True, text=True, timeout=20)
    assert result.returncode == 2
    assert 'Traceback' not in result.stderr


def test_cli_does_not_overwrite_evidence(tmp_path):
    target = tmp_path / 'evidence.json'
    target.write_text('preserved', encoding='utf-8')
    result = subprocess.run([sys.executable, '-m', 'scripts.verify_postgres', '--url', LOCAL,
                             '--output', str(target)], cwd=ROOT, capture_output=True, text=True, timeout=20)
    assert result.returncode == 2
    assert target.read_text(encoding='utf-8') == 'preserved'


def test_cli_redacts_unexpected_driver_failure(monkeypatch, capsys):
    monkeypatch.setattr(sys, 'argv', ['verify_postgres', '--url', LOCAL])
    def fail(*args):
        raise RuntimeError('postgresql://secret:password@remote/private')
    monkeypatch.setattr(verifier, 'run', fail)
    assert verifier.main() == 1
    evidence = json.loads(capsys.readouterr().out)
    assert evidence['passed'] is False
    assert 'password' not in json.dumps(evidence)


def test_run_refuses_preimported_api_before_environment_changes(monkeypatch):
    monkeypatch.setitem(sys.modules, 'api.synthetic_verification_guard', object())
    before = os.environ.copy()
    with pytest.raises(RuntimeError, match='fresh process'):
        verifier.run(LOCAL)
    assert os.environ == before


def test_callback_receives_live_fixture_after_success(monkeypatch):
    events = []
    evidence = {'passed': True}
    engine = Engine(Connection([71, 71]))
    def check(actual, workers):
        assert actual is engine and workers == 4
        events.append('checks')
        return evidence
    def callback(url, schema):
        assert url == LOCAL
        assert engine.connection.statements == [f'CREATE SCHEMA "{schema}"']
        events.append('callback')
    monkeypatch.setattr(verifier, 'verify_ledger', check)
    with verifier.owned_schema(engine) as schema:
        assert verifier.checked_fixture(engine, 4, LOCAL, schema, callback) is evidence
    assert events == ['checks', 'callback']
    assert engine.connection.statements[-1].startswith('DROP SCHEMA')


def test_failed_checks_skip_callback(monkeypatch):
    def fail(*args):
        raise verifier.VerificationFailure('failed')
    monkeypatch.setattr(verifier, 'verify_ledger', fail)
    with pytest.raises(verifier.VerificationFailure):
        verifier.checked_fixture(None, 4, LOCAL, 'synthetic', lambda *args: pytest.fail('callback ran'))


def test_callback_failure_still_cleans_owned_schema(monkeypatch):
    monkeypatch.setattr(verifier, 'verify_ledger', lambda *args: {'passed': True})
    engine = Engine(Connection([71, 71]))
    def callback(*args):
        raise RuntimeError('dump failed')
    with pytest.raises(RuntimeError, match='dump failed'):
        with verifier.owned_schema(engine) as schema:
            verifier.checked_fixture(engine, 4, LOCAL, schema, callback)
    assert engine.connection.statements[-1] == f'DROP SCHEMA "{schema}" CASCADE'
