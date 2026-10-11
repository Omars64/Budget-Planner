"""Dump, encrypt and restore a disposable synthetic PostgreSQL database."""
import argparse
import base64
import hashlib
import json
import io
from pathlib import Path
import re
import subprocess
import tempfile
import time

from cryptography.fernet import Fernet
from sqlalchemy import create_engine, text
from scripts.verify_postgres import run, validate_url


def extend_fixture(engine):
    from decimal import Decimal
    from PIL import Image
    from sqlalchemy.orm import Session
    from api.models import (AppSetting, Budget, Category, Debt, Goal, Note, NoteFolder,
                            NoteShare, Space, SpaceMember, Transaction, TransactionReceipt, User, Wallet)
    from api.spaces import attach_wallet_members
    with Session(engine) as db:
        owner = db.query(User).order_by(User.id).first()
        member = User(username='Recovery member', email='recovery-member@example.test', password_hash='synthetic-only')
        db.add(member); db.flush()
        space = Space(owner_id=owner.id, name='Recovery space', color='blue', currency='KWD')
        db.add(space); db.flush()
        db.add(SpaceMember(space_id=space.id, email=member.email, member_user_id=member.id, role='view'))
        db.flush()
        wallet = Wallet(user_id=owner.id, space_id=space.id, name='Recovery shared', initial_balance=Decimal('12.345'))
        db.add(wallet); db.flush()
        attach_wallet_members(db, wallet)
        category = Category(user_id=owner.id, space_id=space.id, name='Recovery food', kind='expense')
        folder = NoteFolder(user_id=owner.id, space_id=space.id, name='Recovery folder')
        db.add_all([category, folder]); db.flush()
        tx = Transaction(user_id=owner.id, wallet_id=wallet.id, category_id=category.id,
                         type='expense', amount=Decimal('1.125'), description='Recovery receipt')
        note = Note(user_id=owner.id, space_id=space.id, folder_id=folder.id, title='Recovery attachment',
                    note_type='file', attachment_name='synthetic.pdf', attachment_type='application/pdf',
                    attachment_data='data:application/pdf;base64,' + base64.b64encode(b'%PDF-1.4\n%%EOF').decode())
        db.add_all([tx, note]); db.flush()
        image = io.BytesIO()
        Image.new('RGB', (2, 2), 'white').save(image, format='PNG')
        db.add(TransactionReceipt(transaction_id=tx.id, name='synthetic.png',
                                  image='data:image/png;base64,' + base64.b64encode(image.getvalue()).decode()))
        db.add(NoteShare(note_id=note.id, member_id=member.id, permission='view'))
        db.add_all([Budget(user_id=owner.id, space_id=space.id, category_id=category.id, name='Recovery budget',
                           limit_amount=Decimal('20.000'), start_date=tx.date.date()),
                    Goal(user_id=owner.id, name='Recovery goal', target_amount=Decimal('100.000')),
                    Debt(user_id=owner.id, name='Recovery debt', principal=Decimal('10.000'), remaining=Decimal('5.000')),
                    AppSetting(user_id=owner.id, key='synthetic_recovery_marker', value='local fixture only')])
        db.commit()


def fingerprint(engine, schema):
    result = {}
    with engine.connect() as connection:
        names = connection.scalars(text('SELECT tablename FROM pg_tables WHERE schemaname=:schema'),
                                   {'schema': schema}).all()
        quote = engine.dialect.identifier_preparer.quote
        for name in sorted(names):
            rows = sorted(connection.scalars(text(
                f'SELECT row_to_json(t)::text FROM {quote(schema)}.{quote(name)} t')).all())
            result[name] = {'rows': len(rows), 'sha256': hashlib.sha256('\n'.join(rows).encode()).hexdigest()}
    return result


USER_RELATIONS_SQL = """
SELECT n.nspname AS schema, c.relname AS name, c.relkind AS kind
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'
"""

SEQUENCES_SQL = """
SELECT s.sequencename AS name, s.data_type, s.start_value, s.min_value,
       s.max_value, s.increment_by, s.cycle, s.cache_size,
       tn.nspname AS table_schema, t.relname AS table_name, a.attname AS column_name
FROM pg_sequences s
JOIN pg_namespace sn ON sn.nspname=s.schemaname
JOIN pg_class seq ON seq.relnamespace=sn.oid AND seq.relname=s.sequencename AND seq.relkind='S'
LEFT JOIN pg_depend d ON d.classid='pg_class'::regclass AND d.objid=seq.oid
    AND d.refclassid='pg_class'::regclass AND d.deptype IN ('a', 'i')
LEFT JOIN pg_class t ON t.oid=d.refobjid
LEFT JOIN pg_namespace tn ON tn.oid=t.relnamespace
LEFT JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=d.refobjsubid
WHERE s.schemaname=:schema ORDER BY s.sequencename
"""


def qualified(engine, schema, name):
    quote = engine.dialect.identifier_preparer.quote
    return f'{quote(schema)}.{quote(name)}'


def require_exclusive_source(engine, schema, expected_tables):
    """Refuse whole-database export unless only the owned fixture has user relations."""
    if not re.fullmatch(r'budgetly_verification_[0-9a-f]{32}', schema):
        raise ValueError('Source schema is not an owned verification fixture')
    with engine.connect() as connection:
        relations = connection.execute(text(USER_RELATIONS_SQL)).mappings().all()
        schemas = connection.scalars(text("SELECT nspname FROM pg_namespace WHERE "
                                          "nspname <> 'information_schema' AND nspname !~ '^pg_'")).all()
        other_objects = connection.scalar(text("""
            SELECT (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                    WHERE n.nspname <> 'information_schema' AND n.nspname !~ '^pg_')
                 + (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
                    WHERE n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'
                      AND t.typrelid=0 AND t.typelem=0)
        """))
    if set(schemas) - {schema, 'public'}:
        raise ValueError('Source contains an unrelated user schema; no dump attempted')
    if other_objects:
        raise ValueError('Source contains unrelated user routines or types; no dump attempted')
    tables = set()
    for relation in relations:
        if relation['schema'] != schema or relation['kind'] not in {'r', 'p', 'S', 'i', 'I'}:
            raise ValueError('Source contains unrelated user relations; no dump attempted')
        if relation['kind'] in {'r', 'p'}:
            tables.add(relation['name'])
    if not tables or tables != set(expected_tables):
        raise ValueError('Source tables differ from the synthetic API fixture; no dump attempted')
    sequences = sequence_fingerprint(engine, schema)
    for sequence in sequences.values():
        if (sequence['table_schema'] != schema or sequence['table_name'] not in tables
                or not sequence['column_name']):
            raise ValueError('Source contains an unrelated sequence; no dump attempted')
    return sequences


def sequence_fingerprint(engine, schema):
    result = {}
    with engine.connect() as connection:
        definitions = connection.execute(text(SEQUENCES_SQL), {'schema': schema}).mappings().all()
        for definition in definitions:
            state = connection.execute(text(
                f'SELECT last_value, is_called FROM {qualified(engine, schema, definition["name"])}'
            )).mappings().one()
            if definition['name'] in result:
                raise RuntimeError('Ambiguous sequence ownership')
            result[definition['name']] = {**definition, **state}
    return result


def verify_restored_sequences(engine, schema, expected):
    if not expected or sequence_fingerprint(engine, schema) != expected:
        raise RuntimeError('Restored sequence definitions, ownership or state differ')
    for sequence in expected.values():
        if sequence['increment_by'] <= 0 or sequence['cycle']:
            raise RuntimeError('Sequence probe requires increasing noncycling fixture sequences')
    with engine.connect() as connection:
        transaction = connection.begin()
        try:
            users = qualified(engine, schema, 'users')
            previous_id = connection.scalar(text(f'SELECT max(id) FROM {users}'))
            # Explicit qualification prevents the probe from using any public table.
            inserted_id = connection.scalar(text(f'INSERT INTO {users} '
                '(username, email, password_hash, role, active, created_at) '
                "VALUES ('Recovery probe', 'sequence-probe@example.test', 'synthetic-only', "
                "'user', true, CURRENT_TIMESTAMP) RETURNING id"))
            if previous_id is not None and inserted_id <= previous_id:
                raise RuntimeError('Restored insertion did not allocate an ID beyond existing IDs')
            for name, sequence in expected.items():
                if sequence['table_schema'] != schema or not sequence['table_name'] or not sequence['column_name']:
                    raise RuntimeError('Sequence probe requires owned fixture columns')
                table = qualified(engine, schema, sequence['table_name'])
                column = engine.dialect.identifier_preparer.quote(sequence['column_name'])
                maximum = connection.scalar(text(f'SELECT max({column}) FROM {table}'))
                next_value = connection.scalar(text('SELECT nextval(CAST(:sequence AS regclass))'),
                                               {'sequence': qualified(engine, schema, name)})
                if maximum is not None and next_value <= maximum:
                    raise RuntimeError('Restored sequence next value collides with existing IDs')
        finally:
            transaction.rollback()
    return {'sequences': len(expected), 'sequence_state_equal': True,
            'sequence_next_values_safe': True, 'post_restore_insertion_safe': True}


def empty_target(engine):
    with engine.connect() as connection:
        return not connection.scalar(text("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','S','v','m')"))


def rehearse(source, target, pg_bin, workers=4):
    source_url, target_url = validate_url(source), validate_url(target)
    if (source_url.host, source_url.port) != (target_url.host, target_url.port) or source_url.database == target_url.database:
        raise ValueError('Use different dedicated databases on the same disposable loopback server')
    executables = {}
    for name in ('pg_dump', 'pg_restore'):
        executable = Path(pg_bin).resolve() / (name + '.exe')
        if not executable.is_file():
            executable = Path(pg_bin).resolve() / name
        if not executable.is_file():
            raise ValueError('PostgreSQL dump/restore executables are required')
        executables[name] = executable
    recovery = {}

    def before_cleanup(scoped_source, schema):
        source_engine = create_engine(scoped_source)
        target_engine = create_engine(target_url)
        try:
            if not empty_target(target_engine):
                raise ValueError('Restore target is not empty; no restore attempted')
            extend_fixture(source_engine)
            from api.database import Base
            sequences_before = require_exclusive_source(source_engine, schema,
                                                        {table.name for table in Base.metadata.tables.values()})
            before = fingerprint(source_engine, schema)
            started = time.perf_counter()
            with tempfile.TemporaryDirectory(prefix='database-recovery-', dir='.verification') as directory:
                archive = Path(directory) / 'synthetic.dump'
                def command(name, arguments):
                    result = subprocess.run([str(executables[name]), *arguments], capture_output=True, timeout=120)
                    if result.returncode:
                        raise RuntimeError('Synthetic PostgreSQL dump/restore failed; diagnostic output withheld')
                libpq_source = source_url.set(drivername='postgresql').render_as_string(hide_password=False)
                libpq_target = target_url.set(drivername='postgresql').render_as_string(hide_password=False)
                command('pg_dump', ['--dbname', libpq_source, '--format=custom', '--no-owner', '--no-acl', '--file', str(archive)])
                original = archive.read_bytes()
                cipher = Fernet(Fernet.generate_key())
                encrypted = cipher.encrypt(original)
                recovered = cipher.decrypt(encrypted)
                if recovered != original:
                    raise RuntimeError('Encrypted database archive differs')
                archive.write_bytes(recovered)
                command('pg_restore', ['--dbname', libpq_target, '--exit-on-error', '--no-owner', '--no-acl', str(archive)])
            after = fingerprint(target_engine, schema)
            if before != after or not before:
                raise RuntimeError('Restored table contents differ')
            sequence_checks = verify_restored_sequences(target_engine, schema, sequences_before)
            if fingerprint(target_engine, schema) != before:
                raise RuntimeError('Post-restore probe changed restored table contents')
            recovery.update(passed=True, tables=len(before), rows=sum(item['rows'] for item in before.values()),
                            encrypted_roundtrip=True, table_contents_equal=True,
                            source_exclusive=True, **sequence_checks,
                            elapsed_seconds=round(time.perf_counter() - started, 3))
        finally:
            source_engine.dispose()
            target_engine.dispose()

    concurrency = run(source, workers, before_cleanup=before_cleanup)
    return {'schema_version': 1, 'passed': True, 'concurrency': concurrency, 'database_recovery': recovery,
            'limitations': ['Synthetic local PostgreSQL only', 'No production provider retrieval, key escrow, outage or recovery SLA proven']}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True)
    parser.add_argument('--target', required=True)
    parser.add_argument('--pg-bin', required=True)
    parser.add_argument('--workers', type=int, default=4)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    try:
        result = rehearse(args.source, args.target, args.pg_bin, args.workers)
    except Exception:
        print('Synthetic database recovery failed; no connection details printed')
        return 1
    if args.output:
        with args.output.open('x', encoding='utf-8') as output:
            json.dump(result, output, indent=2)
    print(json.dumps(result, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
