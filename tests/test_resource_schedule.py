"""Synthetic SQLite only; no production configuration or notification delivery."""
import hashlib
import json
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from cryptography.fernet import Fernet
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session

from api import update_push as push
from api.database import Base
from api.models import AppSetting, PlannedTransaction, Space, SpaceMember, User, Wallet, WalletShare
from api.resource_schedule import next_scheduler_wake


NOW = datetime(2026, 10, 23, 6, tzinfo=timezone.utc)
LOCAL = datetime(2026, 10, 23, 9)


@pytest.fixture
def workspace(monkeypatch):
    monkeypatch.setenv('UPDATE_PUSH_ENCRYPTION_KEY', Fernet.generate_key().decode())
    monkeypatch.setattr(push, 'send_device', lambda *a, **kw: pytest.fail('Calculator sent a notification'))
    engine = create_engine('sqlite://')
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        user = User(username='Synthetic', email='scheduler@example.test', password_hash='unused')
        db.add(user)
        db.flush()
        wallet = Wallet(user_id=user.id, name='Synthetic wallet')
        db.add(wallet)
        db.commit()
        yield db, user, wallet
    engine.dispose()


def plan(db, user, wallet, **changes):
    values = dict(owner_id=user.id, created_by_id=user.id, wallet_id=wallet.id,
                  type='expense', amount=1, description='Synthetic',
                  due_at=LOCAL + timedelta(days=1), status='planned', reminder_enabled=True)
    values.update(changes)
    row = PlannedTransaction(**values)
    db.add(row)
    db.commit()
    return row


def device(db, user, **changes):
    values = dict(enabled=True, mode='before', minutes=60)
    values.update(changes)
    row = push.UpdatePushDevice(id=str(uuid4()), user_id=user.id, platform='browser',
        payload=push.cipher().encrypt(json.dumps({'credentials': {}, 'upcoming': values}).encode()).decode(),
        installed_version='1.0.0')
    db.add(row)
    db.commit()
    return row


def receipt(db, row, item):
    occurrence = hashlib.sha256(f'{item.id}:{item.due_at.isoformat()}'.encode()).hexdigest()
    db.add(push.UpcomingPushReceipt(device_id=row.id, occurrence=occurrence))
    db.commit()


def test_empty_and_non_scheduled_plans_are_idle(workspace):
    db, user, wallet = workspace
    assert next_scheduler_wake(db, NOW) is None
    for status in ('planned', 'posted', 'failed'):
        plan(db, user, wallet, status=status)
    assert next_scheduler_wake(db, NOW) is None


@pytest.mark.parametrize('offset', [-60, 0, 120])
@pytest.mark.parametrize('aware', [True, False])
def test_scheduled_kuwait_to_utc_and_overdue(workspace, offset, aware):
    db, user, wallet = workspace
    plan(db, user, wallet, status='scheduled', due_at=LOCAL + timedelta(minutes=offset))
    now = NOW if aware else NOW.replace(tzinfo=None)
    assert next_scheduler_wake(db, now) == now + timedelta(minutes=max(0, offset))


def test_earliest_scheduled_regardless_of_access_or_reminder(workspace):
    db, user, wallet = workspace
    plan(db, user, wallet, status='scheduled', due_at=LOCAL + timedelta(days=2))
    plan(db, user, wallet, status='scheduled', due_at=LOCAL + timedelta(hours=1), reminder_enabled=False)
    user.active = False
    wallet.archived = True
    db.commit()
    assert next_scheduler_wake(db, NOW) == NOW + timedelta(hours=1)


@pytest.mark.parametrize('expired', [False, True])
def test_pending_scheduled_delivery_requires_now_even_for_cancellation(workspace, expired):
    db, user, wallet = workspace
    item = plan(db, user, wallet, status='failed')
    row = device(db, user, enabled=False)
    db.add(push.ScheduledPush(plan_id=item.id, device_id=row.id,
                             created_at=NOW.replace(tzinfo=None) - timedelta(days=2 if expired else 0)))
    db.commit()
    assert next_scheduler_wake(db, NOW) == NOW
    db.query(push.ScheduledPush).update({'sent_at': NOW.replace(tzinfo=None)})
    db.commit()
    assert next_scheduler_wake(db, NOW) is None


def test_reminder_without_any_scheduled_posting_and_minimum_across_devices(workspace):
    db, user, wallet = workspace
    plan(db, user, wallet)
    device(db, user, minutes=60)
    device(db, user, minutes=120)
    assert next_scheduler_wake(db, NOW) == NOW + timedelta(hours=22)
    plan(db, user, wallet, status='scheduled', due_at=LOCAL + timedelta(hours=3))
    assert next_scheduler_wake(db, NOW) == NOW + timedelta(hours=1)


@pytest.mark.parametrize('due,preference,expected', [
    (datetime(2027, 1, 1, 0, 15), dict(mode='before', minutes=90), datetime(2026, 12, 31, 19, 45)),
    (datetime(2026, 10, 24, 7), dict(mode='calendar', days=0, time='09:00'), datetime(2026, 10, 24, 3, 55)),
    (datetime(2026, 10, 25, 14), dict(mode='calendar', days=1, time='09:00'), datetime(2026, 10, 24, 6)),
])
def test_calendar_and_before_timing(workspace, due, preference, expected):
    db, user, wallet = workspace
    plan(db, user, wallet, due_at=due)
    device(db, user, **preference)
    assert next_scheduler_wake(db, NOW) == expected.replace(tzinfo=timezone.utc)


@pytest.mark.parametrize('age,expected_now', [(0, True), (359, True), (360, False), (361, False)])
def test_catchup_retry_window_is_strict(workspace, age, expected_now):
    db, user, wallet = workspace
    plan(db, user, wallet, due_at=LOCAL + timedelta(minutes=500 - age))
    device(db, user, minutes=500)
    assert next_scheduler_wake(db, NOW) == (NOW if expected_now else None)


def test_receipts_are_per_device_and_occurrence(workspace):
    db, user, wallet = workspace
    item = plan(db, user, wallet, due_at=LOCAL + timedelta(minutes=60))
    first = device(db, user)
    receipt(db, first, item)
    assert next_scheduler_wake(db, NOW) is None
    second = device(db, user)
    assert next_scheduler_wake(db, NOW) == NOW
    receipt(db, second, item)
    item.due_at += timedelta(minutes=1)
    db.commit()
    assert next_scheduler_wake(db, NOW) == NOW + timedelta(minutes=1)


@pytest.mark.parametrize('change', ['plan_optout', 'device_optout', 'posted', 'failed', 'past', 'archived', 'inactive', 'android', 'unrelated'])
def test_ineligible_reminders_do_not_create_work(workspace, change):
    db, user, wallet = workspace
    item = plan(db, user, wallet)
    row = device(db, user, enabled=change != 'device_optout')
    if change == 'plan_optout': item.reminder_enabled = False
    if change in ('posted', 'failed'): item.status = change
    if change == 'past': item.due_at = LOCAL
    if change == 'archived': wallet.archived = True
    if change == 'inactive': user.active = False
    if change == 'android': row.platform = 'android'
    if change == 'unrelated':
        other = User(username='Other', email='other@example.test', password_hash='unused')
        db.add(other)
        db.flush()
        wallet.user_id = other.id
    db.commit()
    assert next_scheduler_wake(db, NOW) is None


@pytest.mark.parametrize('space', [False, True])
def test_shared_access_and_revocation(workspace, space):
    db, user, wallet = workspace
    plan(db, user, wallet)
    other = User(username='Member', email='member@example.test', password_hash='unused')
    db.add(other)
    db.commit()
    device(db, other)
    if space:
        group = Space(owner_id=user.id, name='Synthetic space')
        db.add(group)
        db.flush()
        wallet.space_id = group.id
        grant = SpaceMember(space_id=group.id, email=other.email, role='view')
    else:
        grant = WalletShare(wallet_id=wallet.id, owner_id=user.id, invitee_email=other.email, permission='view')
    db.add(grant)
    db.commit()
    assert next_scheduler_wake(db, NOW) == NOW + timedelta(hours=23)
    db.delete(grant)
    db.commit()
    assert next_scheduler_wake(db, NOW) is None


def test_far_future_reminder_is_not_lost(workspace):
    db, user, wallet = workspace
    plan(db, user, wallet, due_at=LOCAL + timedelta(days=60))
    device(db, user, minutes=43200)
    assert next_scheduler_wake(db, NOW) == NOW + timedelta(days=30)


def test_quiet_settings_cannot_delay_server_reminder(workspace):
    db, user, wallet = workspace
    plan(db, user, wallet, due_at=LOCAL + timedelta(minutes=60))
    device(db, user)
    for key, value in [('quiet_hours_enabled', 'true'), ('quiet_start', '22:00'), ('quiet_end', '10:00'), ('reminders_enabled', 'false')]:
        db.add(AppSetting(user_id=user.id, key=key, value=value))
    db.commit()
    assert next_scheduler_wake(db, NOW) == NOW


@pytest.mark.parametrize('bad', ['ciphertext', 'preference', 'missing_key'])
def test_unreadable_preferences_fail_open(workspace, monkeypatch, bad):
    db, user, wallet = workspace
    plan(db, user, wallet)
    row = device(db, user)
    if bad == 'ciphertext': row.payload = 'broken'
    if bad == 'preference':
        row.payload = push.cipher().encrypt(b'{"credentials":{},"upcoming":{"minutes":0}}').decode()
    if bad == 'missing_key': monkeypatch.delenv('UPDATE_PUSH_ENCRYPTION_KEY')
    db.commit()
    assert next_scheduler_wake(db, NOW) == NOW


def test_no_writes_autoflush_commits_or_rollback(workspace, monkeypatch):
    db, user, wallet = workspace
    plan(db, user, wallet)
    device(db, user)
    statements = []
    event.listen(db.get_bind(), 'before_cursor_execute', lambda conn, cursor, statement, *args: statements.append(statement))
    for method in ('flush', 'commit', 'rollback'):
        monkeypatch.setattr(db, method, lambda: pytest.fail('Calculator changed the session'))
    assert next_scheduler_wake(db, NOW) == NOW + timedelta(hours=23)
    assert statements and all(sql.lstrip().upper().startswith('SELECT') for sql in statements)
    user.username = 'Unflushed change'
    assert next_scheduler_wake(db, NOW) == NOW
    assert user in db.dirty


def test_database_failure_fails_open_without_rollback(workspace, monkeypatch):
    db, _, _ = workspace
    def unavailable(*args, **kwargs):
        raise RuntimeError('Synthetic database unavailable')
    monkeypatch.setattr(db, 'query', unavailable)
    monkeypatch.setattr(db, 'rollback', lambda: pytest.fail('Calculator rolled back caller state'))
    assert next_scheduler_wake(db, NOW) == NOW
