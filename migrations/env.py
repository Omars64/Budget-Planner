"""Alembic environment for Budgetly's SQLAlchemy models."""
import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine

from api.database import Base, DATABASE_URL, engine
from api import models, reliability_models, ai_models, passkeys  # noqa: F401

config = context.config
if config.config_file_name:
    fileConfig(config.config_file_name)
target_metadata = Base.metadata


def run_migrations_offline():
    context.configure(url=os.getenv('BUDGETLY_MIGRATION_DATABASE_URL', DATABASE_URL),
                      target_metadata=target_metadata, literal_binds=True, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online():
    supplied = config.attributes.get('connection')
    override = os.getenv('BUDGETLY_MIGRATION_DATABASE_URL')
    if supplied is not None:
        context.configure(connection=supplied, target_metadata=target_metadata, compare_type=True)
        with context.begin_transaction():
            context.run_migrations()
    else:
        active = create_engine(override) if override else engine
        try:
            with active.connect() as connection:
                context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
                with context.begin_transaction():
                    context.run_migrations()
        finally:
            if override:
                active.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
