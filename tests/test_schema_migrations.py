from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

from api.app import app  # noqa: F401 - registers all model tables
from api.database import Base
from api.index import ensure_note_columns
from api.schema_migrations import apply_migrations

LATEST_REVISION = 'b72f41e906ad'


def test_new_and_existing_schemas_reach_baseline_without_losing_rows():
    engine = create_engine('sqlite://')
    with engine.begin() as connection:
        apply_migrations(connection, ensure_note_columns)
        assert 'transactions' in inspect(connection).get_table_names()
        assert 'planned_transactions' in inspect(connection).get_table_names()
        assert 'reporting_month' in {column['name'] for column in inspect(connection).get_columns('transactions')}
        assert 'card_network' in {column['name'] for column in inspect(connection).get_columns('wallets')}
        assert 'wallet_balance_checks' in inspect(connection).get_table_names()
        assert 'reporting_month' in {column['name'] for column in inspect(connection).get_columns('budgets')}
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


def test_reporting_month_migration_backfills_old_transaction_dates():
    engine = create_engine('sqlite://')
    config = Config(str(Path(__file__).resolve().parents[1] / 'alembic.ini'))
    with engine.begin() as connection:
        config.attributes['connection'] = connection
        command.upgrade(config, 'c514ac073e91')
        connection.execute(text("INSERT INTO users (id, username, email, password_hash, role, active) VALUES (1, 'Kept', 'kept@migration.test', 'hash', 'user', 1)"))
        connection.execute(text("INSERT INTO budgets (id, user_id, name, limit_amount, period, start_date) VALUES (1, 1, 'Existing budget', 50, 'monthly', '2026-08-01')"))
        connection.execute(text("INSERT INTO wallets (id, user_id, name, type, initial_balance, color, archived, created_at) VALUES (1, 1, 'Main', 'cash', 0, '#3158aa', 0, '2026-08-01 09:00:00')"))
        connection.execute(text("INSERT INTO transactions (id, user_id, type, amount, description, notes, date, wallet_id, recurring_frequency, is_opening_balance) VALUES (1, 1, 'income', 100, 'Existing salary', '', '2026-08-31 18:30:00', 1, 'none', 0)"))
        connection.execute(text("INSERT INTO planned_transactions (id, owner_id, created_by_id, wallet_id, type, amount, description, notes, due_at, status, reminder_enabled, posted_transaction_id, created_at) VALUES (1, 1, 1, 1, 'expense', 10, 'Existing plan', '', '2026-09-05 12:00:00', 'posted', 1, 1, '2026-08-01 09:00:00')"))
        command.upgrade(config, 'head')
        assert connection.execute(text('SELECT reporting_month FROM transactions WHERE id = 1')).scalar_one() == '2026-08'
        assert connection.execute(text('SELECT date FROM transactions WHERE id = 1')).scalar_one() == '2026-08-31 18:30:00'
        assert connection.execute(text('SELECT reporting_month FROM planned_transactions WHERE id = 1')).scalar_one() == '2026-09'
        assert connection.execute(text('SELECT posted_transaction_id FROM planned_transactions WHERE id = 1')).scalar_one() == 1
        assert connection.execute(text('SELECT card_network FROM wallets WHERE id = 1')).scalar_one() is None
        assert connection.execute(text('SELECT COUNT(*) FROM wallet_balance_checks')).scalar_one() == 0
        assert connection.execute(text('SELECT reporting_month FROM budgets WHERE id = 1')).scalar_one() is None
        assert connection.execute(text('SELECT limit_amount FROM budgets WHERE id = 1')).scalar_one() == 50
    engine.dispose()
