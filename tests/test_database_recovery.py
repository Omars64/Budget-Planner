import pytest
from contextlib import contextmanager
from copy import deepcopy
from types import SimpleNamespace
import sys
from scripts import rehearse_database_recovery as recovery
from scripts.rehearse_database_recovery import rehearse


URL = 'postgresql+psycopg://postgres@127.0.0.1:55432/budgetly_verification_source'


@pytest.mark.parametrize('target', [URL, URL.replace('55432', '55433'),
                                   URL.replace('127.0.0.1', 'example.com'),
                                   URL.replace('budgetly_verification_source', 'production')])
def test_recovery_refuses_unsafe_targets_before_connecting(target):
    with pytest.raises(ValueError):
        rehearse(URL, target, 'nonexistent-binaries')


def test_recovery_requires_postgres_tools_before_connecting(tmp_path):
    with pytest.raises(ValueError, match='executables'):
        rehearse(URL, URL.replace('_source', '_target'), tmp_path)


SCHEMA = 'budgetly_verification_' + 'a' * 32


def definition():
    return dict(name='users_id_seq', data_type='integer', start_value=1, min_value=1,
                max_value=2147483647, increment_by=1, cycle=False, cache_size=1,
                table_schema=SCHEMA, table_name='users', column_name='id')


class Result:
    def __init__(self, rows):
        self.rows = rows

    def mappings(self):
        return self

    def all(self):
        return self.rows

    def one(self):
        assert len(self.rows) == 1
        return self.rows[0]


class Transaction:
    def __init__(self):
        self.rolled_back = False

    def rollback(self):
        self.rolled_back = True


class Connection:
    def __init__(self):
        self.relations = [dict(schema=SCHEMA, name='users', kind='r'),
                          dict(schema=SCHEMA, name='users_id_seq', kind='S'),
                          dict(schema=SCHEMA, name='users_pkey', kind='i')]
        self.schemas = ['public', SCHEMA]
        self.definitions = [definition()]
        self.states = {'users_id_seq': dict(last_value=7, is_called=True)}
        self.maximum = 7
        self.inserted_id = 8
        self.next_value = 9
        self.other_objects = 0
        self.statements = []
        self.transaction = Transaction()

    def execute(self, sql, params=None):
        sql = str(sql)
        self.statements.append((sql, params))
        if sql == recovery.USER_RELATIONS_SQL:
            return Result(self.relations)
        if sql == recovery.SEQUENCES_SQL:
            assert params == {'schema': SCHEMA}
            return Result(self.definitions)
        if 'SELECT last_value, is_called' in sql:
            name = sql.rsplit('.', 1)[1].strip('"')
            return Result([self.states[name]])
        pytest.fail('Unexpected query: ' + sql)

    def scalars(self, sql):
        assert 'FROM pg_namespace' in str(sql)
        return Result(self.schemas)

    def scalar(self, sql, params=None):
        sql = str(sql)
        self.statements.append((sql, params))
        if 'FROM pg_proc' in sql:
            return self.other_objects
        if sql.startswith('SELECT max('):
            return self.maximum
        if sql.startswith('INSERT INTO'):
            return self.inserted_id
        if 'nextval(' in sql:
            assert params['sequence'].startswith(SCHEMA + '.')
            return self.next_value
        pytest.fail('Unexpected scalar: ' + sql)

    def begin(self):
        return self.transaction


class Engine:
    def __init__(self, connection):
        from sqlalchemy.dialects.postgresql import dialect
        self.connection = connection
        self.dialect = dialect()

    @contextmanager
    def connect(self):
        yield self.connection


def test_exclusive_source_accepts_only_owned_fixture():
    connection = Connection()
    sequences = recovery.require_exclusive_source(Engine(connection), SCHEMA, {'users'})
    assert sequences['users_id_seq']['last_value'] == 7
    assert sequences['users_id_seq']['is_called'] is True


@pytest.mark.parametrize('schema,kind', [('public', 'r'), ('foreign_schema', 'S'),
    ('public', 'v'), ('public', 'm'), ('public', 'f'), (SCHEMA, 'v'), (SCHEMA, 'c')])
def test_exclusive_source_rejects_unrelated_relations(schema, kind):
    connection = Connection()
    connection.relations.append(dict(schema=schema, name='unrelated', kind=kind))
    with pytest.raises(ValueError, match='unrelated user relations'):
        recovery.require_exclusive_source(Engine(connection), SCHEMA, {'users'})


@pytest.mark.parametrize('change', ['extra-table', 'missing-table', 'empty', 'schema', 'routine', 'sequence'])
def test_exclusive_source_rejects_unknown_fixture_objects(change):
    connection = Connection()
    if change == 'extra-table':
        connection.relations.append(dict(schema=SCHEMA, name='unexpected', kind='r'))
    elif change == 'missing-table':
        connection.relations = [r for r in connection.relations if r['kind'] != 'r']
    elif change == 'empty':
        connection.relations = []
    elif change == 'schema':
        connection.schemas.append('unrelated')
    elif change == 'routine':
        connection.other_objects = 1
    else:
        connection.definitions[0]['table_name'] = None
    with pytest.raises(ValueError):
        recovery.require_exclusive_source(Engine(connection), SCHEMA, {'users'})


def test_exclusive_source_refuses_nonowned_schema_without_queries():
    with pytest.raises(ValueError, match='owned verification'):
        recovery.require_exclusive_source(None, 'public', {'users'})


def test_sequence_fingerprint_captures_definition_ownership_and_state():
    connection = Connection()
    assert recovery.sequence_fingerprint(Engine(connection), SCHEMA) == {
        'users_id_seq': {**definition(), 'last_value': 7, 'is_called': True}}


@pytest.mark.parametrize('field,value', [('last_value', 1), ('is_called', False),
    ('increment_by', 2), ('cache_size', 5), ('table_name', 'wallets'),
    ('column_name', 'foreign_id'), ('max_value', 100), ('cycle', True)])
def test_sequence_mismatch_fails_before_probe(field, value):
    connection = Connection()
    expected = deepcopy(recovery.sequence_fingerprint(Engine(connection), SCHEMA))
    expected['users_id_seq'][field] = value
    with pytest.raises(RuntimeError, match='state differ'):
        recovery.verify_restored_sequences(Engine(connection), SCHEMA, expected)
    assert not any(sql.startswith('INSERT') for sql, _ in connection.statements)


def test_missing_sequence_fails_before_probe():
    connection = Connection()
    expected = recovery.sequence_fingerprint(Engine(connection), SCHEMA)
    connection.definitions = []
    with pytest.raises(RuntimeError, match='state differ'):
        recovery.verify_restored_sequences(Engine(connection), SCHEMA, expected)


def test_sequence_probe_qualifies_insert_and_rolls_back():
    connection = Connection()
    engine = Engine(connection)
    expected = recovery.sequence_fingerprint(engine, SCHEMA)
    checks = recovery.verify_restored_sequences(engine, SCHEMA, expected)
    assert checks == dict(sequences=1, sequence_state_equal=True,
                          sequence_next_values_safe=True, post_restore_insertion_safe=True)
    assert connection.transaction.rolled_back
    insert = next(sql for sql, _ in connection.statements if sql.startswith('INSERT'))
    assert insert.startswith(f'INSERT INTO {SCHEMA}.users ')
    assert 'RETURNING id' in insert


@pytest.mark.parametrize('failure', ['insert', 'nextval', 'exception'])
def test_sequence_probe_failure_still_rolls_back(failure):
    connection = Connection()
    if failure == 'insert':
        connection.inserted_id = 7
    elif failure == 'nextval':
        connection.next_value = 7
    else:
        original = connection.scalar
        def scalar(sql, params=None):
            if 'nextval(' in str(sql):
                raise RuntimeError('driver failure')
            return original(sql, params)
        connection.scalar = scalar
    expected = recovery.sequence_fingerprint(Engine(connection), SCHEMA)
    with pytest.raises(RuntimeError):
        recovery.verify_restored_sequences(Engine(connection), SCHEMA, expected)
    assert connection.transaction.rolled_back


def test_probe_checks_other_sequences_after_user_insertion():
    connection = Connection()
    connection.definitions.append({**definition(), 'name': 'wallets_id_seq', 'table_name': 'wallets'})
    connection.states['wallets_id_seq'] = dict(last_value=7, is_called=True)
    original = connection.scalar
    def scalar(sql, params=None):
        if 'nextval(' in str(sql) and params['sequence'].endswith('.wallets_id_seq'):
            return 7
        return original(sql, params)
    connection.scalar = scalar
    expected = recovery.sequence_fingerprint(Engine(connection), SCHEMA)
    with pytest.raises(RuntimeError, match='collides with existing IDs'):
        recovery.verify_restored_sequences(Engine(connection), SCHEMA, expected)
    assert connection.transaction.rolled_back
    assert any('nextval' in sql and params['sequence'].endswith('.users_id_seq')
               for sql, params in connection.statements)


@pytest.mark.parametrize('increment,cycle', [(0, False), (-1, False), (1, True)])
def test_probe_refuses_nonincreasing_or_cyclic_sequences(increment, cycle):
    connection = Connection()
    connection.definitions[0].update(increment_by=increment, cycle=cycle)
    expected = recovery.sequence_fingerprint(Engine(connection), SCHEMA)
    with pytest.raises(RuntimeError, match='increasing noncycling'):
        recovery.verify_restored_sequences(Engine(connection), SCHEMA, expected)


def test_source_refusal_prevents_dump_or_restore(monkeypatch, tmp_path):
    for name in ('pg_dump', 'pg_restore'):
        (tmp_path / name).touch()
    disposed = []
    fake_engine = SimpleNamespace(dispose=lambda: disposed.append(True))
    monkeypatch.setattr(recovery, 'create_engine', lambda *args: fake_engine)
    monkeypatch.setattr(recovery, 'empty_target', lambda *args: True)
    monkeypatch.setattr(recovery, 'extend_fixture', lambda *args: None)
    monkeypatch.setitem(sys.modules, 'api.database', SimpleNamespace(
        Base=SimpleNamespace(metadata=SimpleNamespace(tables={'users': SimpleNamespace(name='users')}))))
    def refuse(*args):
        raise ValueError('unrelated source')
    monkeypatch.setattr(recovery, 'require_exclusive_source', refuse)
    monkeypatch.setattr(recovery.subprocess, 'run', lambda *args, **kwargs: pytest.fail('dump was invoked'))
    def fixture(source, workers, before_cleanup):
        before_cleanup(URL, SCHEMA)
    monkeypatch.setattr(recovery, 'run', fixture)
    with pytest.raises(ValueError, match='unrelated source'):
        rehearse(URL, URL.replace('_source', '_target'), tmp_path)
    assert len(disposed) == 2
