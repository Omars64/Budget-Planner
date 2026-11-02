"""Select synthetic storage before any application modules are collected."""
import os
from pathlib import Path
import tempfile
import pytest

_storage = tempfile.TemporaryDirectory(prefix='budgetly-pytest-')
os.environ['FLOWBUDGET_DATABASE_URL'] = 'sqlite:///' + (Path(_storage.name) / 'synthetic.db').as_posix()
os.environ['APP_SECRET'] = 'synthetic-test-secret-not-for-production'
os.environ['ADMIN_INITIAL_PASSWORD'] = 'FlowBudgetAdmin!ChangeMe2026'

# Register every mapped feature before fixtures create or migrate isolated schemas.
from api.app import app as _app  # noqa: E402,F401


@pytest.fixture(autouse=True)
def isolate_request_limits():
    """Each test gets real limiter behavior, without earlier tests' requests."""
    from sqlalchemy import inspect
    from api.database import engine, SessionLocal
    from api.reliability_models import RateBucket

    def clear():
        if inspect(engine).has_table(RateBucket.__tablename__):
            with SessionLocal() as db:
                db.query(RateBucket).delete()
                db.commit()

    clear()
    yield
    clear()


def pytest_sessionfinish(session, exitstatus):
    from api.database import engine
    engine.dispose()
    _storage.cleanup()
