"""Upgrade the database under the startup lock, preserving existing workspaces."""
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect

from .database import Base

BASELINE_REVISION = 'd321cbf4902b'


def apply_migrations(connection, compatibility):
    config = Config(str(Path(__file__).resolve().parents[1] / 'alembic.ini'))
    config.attributes['connection'] = connection
    inspector = inspect(connection)
    existing = set(inspector.get_table_names())
    if 'alembic_version' not in existing and 'users' in existing:
        # Existing installations predate Alembic. Complete the known compatibility
        # columns, then verify before marking their schema as the baseline.
        Base.metadata.create_all(bind=connection)
        compatibility(connection)
        inspector = inspect(connection)
        for name, table in Base.metadata.tables.items():
            present = {column['name'] for column in inspector.get_columns(name)}
            missing = {column.name for column in table.columns} - present
            if missing:
                raise RuntimeError(f'Cannot baseline {name}; missing columns: {sorted(missing)}')
        command.stamp(config, BASELINE_REVISION)
    command.upgrade(config, 'head')
