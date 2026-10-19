"""Load guards are offline; PostgreSQL smoke is explicitly opt-in and subprocess isolated."""
import json
import logging
import os
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace
import warnings

import pytest
from sqlalchemy import create_engine
from sqlalchemy.pool import QueuePool

from scripts import verify_load as load
from scripts import verify_postgres

ROOT = Path(__file__).resolve().parents[1]
LOCAL = 'postgresql+psycopg://postgres@127.0.0.1:55432/budgetly_verification_load'


@pytest.mark.parametrize('url', [LOCAL, LOCAL.replace('+psycopg', ''), LOCAL.replace('127.0.0.1', '[::1]')])
def test_dedicated_loopback(url):
    assert load.validate_url(url).database == 'budgetly_verification_load'


@pytest.mark.parametrize('url', [LOCAL.replace('127.0.0.1', 'localhost'),
    LOCAL.replace('127.0.0.1', 'production.example'), LOCAL.replace('127.0.0.1', '10.0.0.1'),
    LOCAL.replace(':55432', ':5432'), LOCAL.replace(':55432', ''),
    LOCAL.replace('budgetly_verification_load', 'budgetly_verification_other'),
    LOCAL.replace('budgetly_verification_load', 'production'),
    LOCAL + '?host=production', LOCAL + '?service=prod', LOCAL + '?options=-csearch_path=public',
    'sqlite:///flowbudget.db', 'https://production.example/api'])
def test_refuses_unsafe_urls(url):
    with pytest.raises(ValueError):
        load.validate_url(url)


@pytest.mark.parametrize('duration,workers,records,smoke', [
    (0, 16, 1000, False), (-1, 16, 1000, False), (301, 16, 1000, False),
    (float('nan'), 16, 1000, False), (float('inf'), 16, 1000, False),
    (30, 4, 1000, False), (30, 64, 1000, False), (30, 16, 999, False),
    (30, 16, 10001, False), (2, 2, 20, False), (6, 2, 20, True),
    (2, 16, 20, True), (2, 2, 1000, True), (30, 16.0, 1000, False),
])
def test_duration_concurrency_and_volume_guards(duration, workers, records, smoke):
    with pytest.raises(ValueError):
        load.validate_workload(duration, workers, records, smoke)


def test_valid_profiles():
    load.validate_workload(30, 16, 1000)
    load.validate_workload(300, 32, 10000)
    load.validate_workload(2, 2, 20, True)


def test_reuses_original_safety_helpers():
    for name in ('isolated_environment', 'network_guard', 'owned_schema'):
        assert getattr(load, name) is getattr(verify_postgres, name)


def test_aggregate_output_suppresses_diagnostics_and_restores_on_failure(capsys):
    previous = logging.root.manager.disable
    with pytest.raises(RuntimeError):
        with load.aggregate_output():
            logging.getLogger('flowbudget').warning('individual synthetic request')
            warnings.warn('individual diagnostic', UserWarning)
            raise RuntimeError('synthetic failure')
    assert logging.root.manager.disable == previous
    assert capsys.readouterr() == ('', '')


def test_error_diagnostics_observes_pool_timeout_without_changing_behavior():
    # SQLite is in-memory and only tests pool instrumentation, not application routes.
    engine = create_engine('sqlite://', poolclass=QueuePool, pool_size=1,
                           max_overflow=0, pool_timeout=.01)
    original = engine.pool.connect
    try:
        with load.error_diagnostics(engine, True) as diagnostics:
            diagnostics.phase = 'measured'
            with engine.connect():
                with pytest.raises(load.PoolTimeout):
                    engine.connect()
            evidence = diagnostics.evidence()
            assert evidence['observations_by_phase'] == {'measured': {'pool_checkout_timeout': 1}}
            assert evidence['pool']['size'] == 1
            assert evidence['pool']['max_overflow'] == 0
            assert evidence['pool']['checkout_timeout_seconds'] == .01
        assert engine.pool.connect == original
        with engine.connect():
            pass
    finally:
        engine.dispose()


def test_error_diagnostics_restores_after_failure_and_is_opt_in():
    engine = create_engine('sqlite://', poolclass=QueuePool)
    original = engine.pool.connect
    try:
        with load.error_diagnostics(engine, False) as diagnostics:
            assert diagnostics is None and engine.pool.connect == original
        with pytest.raises(RuntimeError):
            with load.error_diagnostics(engine, True):
                raise RuntimeError('synthetic failure')
        assert engine.pool.connect == original
    finally:
        engine.dispose()


def test_request_session_is_retained_during_middleware_second_checkout():
    from fastapi import Depends, FastAPI
    from fastapi.testclient import TestClient
    from sqlalchemy import text
    from sqlalchemy.orm import Session

    engine = create_engine('sqlite://', poolclass=QueuePool, pool_size=1,
                           max_overflow=0, pool_timeout=.01,
                           connect_args={'check_same_thread': False})
    app = FastAPI()
    observations = []

    def database():
        with Session(engine) as db:
            yield db

    @app.get('/synthetic')
    def route(db=Depends(database)):
        assert db.scalar(text('SELECT 1')) == 1
        return {'ok': True}

    @app.middleware('http')
    async def diagnostics(request, call_next):
        response = await call_next(request)
        observations.append(engine.pool.checkedout())
        with pytest.raises(load.PoolTimeout):
            with engine.connect():
                pass
        return response

    client = TestClient(app)
    try:
        assert client.get('/synthetic').status_code == 200
        assert observations == [1]
        assert engine.pool.checkedout() == 0
    finally:
        client.close()
        engine.dispose()


@pytest.mark.parametrize('state,expected', [('55P03', 'postgres_lock_unavailable'),
    ('23505', 'expected_unique_conflict'),
    ('40P01', 'postgres_deadlock'), ('57014', 'postgres_query_cancelled'),
    ('40001', 'postgres_serialization_failure'), ('08006', 'postgres_connection_failure'),
    ('53300', 'postgres_connection_limit'), ('private-secret', 'other_database_error')])
def test_sqlstate_diagnostics_never_retain_exception_text(state, expected):
    engine = create_engine('sqlite://', poolclass=QueuePool)
    try:
        diagnostics = load.ErrorDiagnostics(engine)
        diagnostics.database_error(SimpleNamespace(original_exception=SimpleNamespace(
            sqlstate=state, message='private payload', statement='private SQL', password='private secret')))
        assert diagnostics.evidence()['observations_by_phase'] == {'setup': {expected: 1}}
        assert 'private' not in json.dumps(diagnostics.evidence())
    finally:
        engine.dispose()


@pytest.mark.parametrize('body,expected', [
    ({'detail': 'Workspace is changing. Retry this request.'}, 'owner_lock_unavailable'),
    ({'detail': 'This request identifier was already used for different data'}, 'idempotency_payload_conflict'),
    ({'detail': 'private payload', 'request_id': 'private-id'}, 'unclassified_conflict'),
    ({'detail': ['private payload']}, 'unclassified_conflict'),
])
def test_response_diagnostics_only_emit_known_categories(body, expected):
    engine = create_engine('sqlite://', poolclass=QueuePool)
    try:
        diagnostics = load.ErrorDiagnostics(engine)
        diagnostics.response_error(SimpleNamespace(status_code=409, json=lambda: body))
        assert diagnostics.evidence()['observations_by_phase'] == {'setup': {expected: 1}}
        assert 'private' not in json.dumps(diagnostics.evidence())
    finally:
        engine.dispose()


def test_fresh_process_guard_preserves_environment(monkeypatch):
    monkeypatch.setitem(sys.modules, 'api.synthetic_load_guard', object())
    before = os.environ.copy()
    with pytest.raises(RuntimeError, match='fresh process'):
        load.run(LOCAL)
    assert os.environ == before


def test_aggregate_metrics_include_failed_requests_and_nearest_rank():
    result = load.summarize({'list': [(float(i), i != 20, 500 if i == 20 else 200)
                                    for i in range(1, 21)]}, 2)['list']
    assert result == {'requests': 20, 'errors': 1, 'error_rate': .05,
                      'p50_ms': 10.0, 'p95_ms': 19.0, 'throughput_rps': 10.0,
                      'statuses': {'200': 19, '500': 1}}


def test_shape_rejects_cross_account_rows_and_wrong_shapes():
    with pytest.raises(load.VerificationFailure):
        load.check_shape('list', [{'id': 1, 'type': 'expense', 'amount': 1,
            'wallet_id': 99, 'reporting_month': '2026-10', 'date': '2026-10-01',
            'revision': 'synthetic', 'is_opening_balance': False}], [1], [2])
    for name, body in [('dashboard', {}), ('analytics', {'trend': [], 'categories': []}), ('list', [])]:
        with pytest.raises(load.VerificationFailure):
            load.check_shape(name, body, [1], [2])


@pytest.mark.parametrize('extra', [['--duration', 'nan'], ['--duration', '0'],
    ['--records', '999'], ['--workers', '64'], ['--smoke', '--duration', '30'],
    ['--url', LOCAL + '?host=production']])
def test_cli_rejects_before_connecting(extra):
    result = subprocess.run([sys.executable, '-m', 'scripts.verify_load', '--url', LOCAL, *extra],
                            cwd=ROOT, capture_output=True, text=True, timeout=20)
    assert result.returncode == 2
    assert 'Traceback' not in result.stderr


def test_cli_preserves_existing_report(tmp_path):
    target = tmp_path / 'report.json'
    target.write_text('preserved', encoding='utf-8')
    result = subprocess.run([sys.executable, '-m', 'scripts.verify_load', '--url', LOCAL,
        '--output', str(target)], cwd=ROOT, capture_output=True, text=True, timeout=20)
    assert result.returncode == 2
    assert target.read_text(encoding='utf-8') == 'preserved'


def test_cli_redacts_driver_errors(monkeypatch, capsys):
    monkeypatch.setattr(sys, 'argv', ['load', '--url', LOCAL])
    def fail(*args):
        raise RuntimeError('postgresql://secret:password@production/live')
    monkeypatch.setattr(load, 'run', fail)
    assert load.main() == 1
    evidence = json.loads(capsys.readouterr().out)
    assert not evidence['passed'] and 'password' not in json.dumps(evidence)


@pytest.mark.skipif(not os.getenv('BUDGETLY_LOAD_SMOKE_URL'), reason='explicit disposable PG opt-in required')
def test_quick_postgres_smoke():
    result = subprocess.run([sys.executable, '-m', 'scripts.verify_load', '--url',
        os.environ['BUDGETLY_LOAD_SMOKE_URL'], '--smoke'], cwd=ROOT,
        capture_output=True, text=True, timeout=90)
    assert result.returncode == 0, 'synthetic load smoke failed (raw output suppressed)'
    evidence = json.loads(result.stdout)
    assert evidence['passed'] and evidence['correctness_passed']
    assert evidence['workload']['accounts'] == 2
    assert evidence['workload']['records_per_account'] == 20
    assert evidence['overall']['errors'] == 0
    assert set(evidence['routes']) == {'dashboard', 'list', 'analytics', 'write', 'replay'}
    assert all(row['requests'] > 0 for row in evidence['routes'].values())
    assert not result.stderr
