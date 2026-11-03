"""Select synthetic storage before any application modules are collected."""
import os
import ipaddress
import sys
from pathlib import Path
import tempfile
import pytest

# Scrub inherited credentials before importing modules that cache configuration.
for _name in list(os.environ):
    if _name.upper().startswith(('BACKUP_', 'AWS_', 'GOOGLE_', 'SMTP_', 'GMAIL_',
                                  'EMAIL_', 'FIREBASE_', 'OPENAI_', 'PG',
                                  'KV_REST_API_', 'UPSTASH_REDIS_REST_', 'BUDGETLY_RESOURCE_')) or _name.upper() in {
        'CRON_SECRET', 'SCHEDULE_RUNNER_SECRET', 'UPDATE_RELEASE_SECRET',
        'VERCEL', 'ADMIN_INITIAL_EMAIL',
        'FLOWBUDGET_DATABASE_URL', 'FLOWBUDGET_POSTGRES_URL', 'DATABASE_URL',
        'FLOWBUDGET_URL', 'POSTGRES_URL', 'FLOWBUDGET_DATABASE_URL_UNPOOLED',
        'DATABASE_URL_UNPOOLED', 'FLOWBUDGET_URL_UNPOOLED',
    }:
        os.environ.pop(_name)
os.environ['AWS_EC2_METADATA_DISABLED'] = 'true'
os.environ['AWS_SHARED_CREDENTIALS_FILE'] = os.devnull
os.environ['AWS_CONFIG_FILE'] = os.devnull
os.environ['ADMIN_INITIAL_EMAIL'] = 'admin@synthetic.test'


def _local_host(host):
    if isinstance(host, bytes):
        host = host.decode('ascii')
    if host == 'localhost':
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _network_guard(event, args):
    # An audit hook applies during collection as well as fixture setup/teardown,
    # and cannot be bypassed by a test restoring socket.connect after a mock.
    if event == 'socket.getaddrinfo':
        host = args[0]
    elif event in {'socket.connect', 'socket.sendto'}:
        address = args[1] if event == 'socket.connect' else args[-1]
        if not isinstance(address, tuple):  # local Unix sockets/socketpair
            return
        host = address[0]
    else:
        return
    if not _local_host(host):
        raise RuntimeError('External network access disabled in synthetic tests')


sys.addaudithook(_network_guard)

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
