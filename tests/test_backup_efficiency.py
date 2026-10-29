"""Synthetic private storage only; no provider credentials or production records."""
from datetime import datetime, timedelta
import io

import boto3
import pytest
from cryptography.fernet import Fernet
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from api.app import app  # noqa: F401 - register tables
from api import backup_efficiency as efficiency, index, operations
from api.database import Base
from api.models import User
from api.reliability_models import ServiceEvent


@pytest.fixture
def backup(monkeypatch):
    for key, value in {'BACKUP_S3_BUCKET': 'synthetic-private', 'BACKUP_S3_REGION': 'us-east-1',
                       'BACKUP_S3_ACCESS_KEY_ID': 'synthetic', 'BACKUP_S3_SECRET_ACCESS_KEY': 'synthetic',
                       'BACKUP_ENCRYPTION_KEY': Fernet.generate_key().decode()}.items():
        monkeypatch.setenv(key, value)
    objects, puts = {}, []
    class Storage:
        def put_object(self, **row):
            objects[row['Key']] = row['Body']
            puts.append(row['Key'])
        def get_object(self, **row):
            return {'Body': io.BytesIO(objects[row['Key']])}
    monkeypatch.setattr(boto3, 'client', lambda *args, **kwargs: Storage())
    monkeypatch.setattr(efficiency, 'policy', lambda: {'backup_skip_unchanged': True, 'backup_interval_hours': 6})
    monkeypatch.setattr(efficiency, 'metric', lambda name: None)
    clock = [datetime(2026, 10, 29, 1)]
    monkeypatch.setattr(operations, 'utc_now', lambda: clock[0])
    data = {'version': 1, 'exported_at': 'changes-every-export', 'settings': {},
            **{name: [] for name in ('wallets', 'categories', 'transactions', 'budgets', 'goals', 'debts')}}
    monkeypatch.setattr(index, 'export_backup', lambda user, db: data.copy())
    engine = create_engine('sqlite://')
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        db.add(User(username='Synthetic', email='synthetic@example.test', password_hash='unused'))
        db.commit()
        yield db, objects, puts, clock, data
    engine.dispose()


def expire(db, clock, hours=7):
    clock[0] += timedelta(hours=hours)
    # ServiceEvent default uses the real clock; set explicitly for deterministic tests.
    for event in db.query(ServiceEvent).filter_by(area='external-backup').all():
        event.created_at = clock[0] - timedelta(hours=hours)
    db.commit()


def test_unchanged_run_authenticates_existing_backup_and_skips_only_uploads(backup):
    db, objects, puts, clock, data = backup
    assert operations.external_snapshots(db, force=False) == 1
    before = list(puts)
    expire(db, clock)
    data['exported_at'] = 'new-export-time'
    assert operations.external_snapshots(db, force=False) == 0
    assert puts == before
    assert db.query(ServiceEvent).filter_by(area='external-backup', status=200).count() == 2


@pytest.mark.parametrize('change', ['records', 'identity', 'corrupt', 'missing', 'aged'])
def test_change_or_invalid_prior_copy_always_creates_fresh_archives(backup, change):
    db, objects, puts, clock, data = backup
    assert operations.external_snapshots(db, force=False) == 1
    expire(db, clock, 169 if change == 'aged' else 7)
    archive = next(key for key in objects if '/user-' in key)
    if change == 'records':
        data['transactions'] = [{'id': 1, 'description': 'Synthetic change'}]
    elif change == 'identity':
        db.query(User).first().username = 'Changed synthetic name'
        db.commit()
    elif change == 'corrupt':
        objects[archive] = b'invalid ciphertext'
    elif change == 'missing':
        del objects[archive]
    assert operations.external_snapshots(db, force=False) == 1
    assert sum('/user-' in key for key in puts) == 2


def test_automatic_interval_skips_export_but_manual_backup_ignores_it(backup, monkeypatch):
    db, objects, puts, clock, data = backup
    assert operations.external_snapshots(db, force=False) == 1
    db.query(ServiceEvent).update({'created_at': clock[0]})
    db.commit()
    with monkeypatch.context() as patch:
        patch.setattr(index, 'export_backup', lambda *args: pytest.fail('Interval skip must not export'))
        assert operations.external_snapshots(db, force=False) == 0
    assert operations.external_snapshots(db, force=True) == 1
    assert sum('/user-' in key for key in puts) == 2


def test_last_failure_cannot_suppress_retry(backup):
    db, objects, puts, clock, data = backup
    db.add(ServiceEvent(area='external-backup', status=500, created_at=clock[0]))
    db.commit()
    assert operations.external_snapshots(db, force=False) == 1


def test_daily_cron_jitter_cannot_skip_an_entire_backup_day(backup, monkeypatch):
    db, objects, puts, clock, data = backup
    monkeypatch.setattr(efficiency, 'policy', lambda: {'backup_skip_unchanged': False, 'backup_interval_hours': 24})
    db.add(ServiceEvent(area='external-backup', status=200, created_at=clock[0] - timedelta(hours=24) + timedelta(seconds=30)))
    db.commit()
    assert operations.external_snapshots(db, force=False) == 1
