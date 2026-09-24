from sqlalchemy import create_engine, inspect, text

from api.app import app  # noqa: F401 - registers all model tables
from api.database import Base
from api.index import ensure_note_columns
from api.schema_migrations import apply_migrations

LATEST_REVISION = 'a27d84b75c40'


def test_new_and_existing_schemas_reach_baseline_without_losing_rows():
    engine = create_engine('sqlite://')
    with engine.begin() as connection:
        apply_migrations(connection, ensure_note_columns)
        assert 'transactions' in inspect(connection).get_table_names()
        assert connection.execute(text('SELECT version_num FROM alembic_version')).scalar_one() == LATEST_REVISION
        connection.execute(text("INSERT INTO users (username, email, password_hash, role, active) VALUES ('Test', 'test@migration.test', 'hash', 'user', 1)"))
    with engine.begin() as connection:
        apply_migrations(connection, ensure_note_columns)
        assert connection.execute(text('SELECT username FROM users')).scalar_one() == 'Test'
    engine.dispose()

    legacy = create_engine('sqlite://')
    Base.metadata.create_all(legacy)
    with legacy.begin() as connection:
        connection.execute(text("INSERT INTO users (username, email, password_hash, role, active) VALUES ('Kept', 'kept@migration.test', 'hash', 'user', 1)"))
        apply_migrations(connection, ensure_note_columns)
        assert connection.execute(text('SELECT username FROM users')).scalar_one() == 'Kept'
        assert connection.execute(text('SELECT version_num FROM alembic_version')).scalar_one() == LATEST_REVISION
    legacy.dispose()
