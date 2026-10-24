from datetime import datetime, timedelta
import pytest
from api import upcoming_reminders as reminders
from api import update_push as push
from api.models import Wallet, PlannedTransaction, User, WalletShare
from tests.test_update_push import workspace, payload


def setup_plan(client, db, user, monkeypatch):
    now = datetime(2026, 10, 21, 9)
    monkeypatch.setattr(reminders, 'ledger_now', lambda: now)
    body = payload()
    body.update(updates=False, upcoming={'enabled':True, 'mode':'calendar','days':1,'time':'09:00'})
    assert client.put('/api/app-updates/push-device', json=body).status_code == 200
    wallet = Wallet(user_id=user.id, name='Private wallet', initial_balance=0)
    db.add(wallet); db.flush()
    plan = PlannedTransaction(owner_id=user.id, created_by_id=user.id, wallet_id=wallet.id,
        type='expense',amount=12.345,description='Rent payment',notes='',due_at=now+timedelta(days=1,hours=5),status='planned',reminder_enabled=True)
    db.add(plan); db.commit()
    return body, wallet, plan


def test_closed_browser_subject_retry_and_deduplication(workspace, monkeypatch):
    client, db, user = workspace
    body, wallet, plan = setup_plan(client, db, user, monkeypatch)
    sent = []
    monkeypatch.setattr(push, 'send_device', lambda *args, **kwargs: 503)
    assert reminders.dispatch_upcoming(db)['failed'] == 1
    assert db.query(push.UpcomingPushReceipt).count() == 0
    monkeypatch.setattr(push, 'send_device', lambda *args, **kwargs: sent.append(kwargs['notice']) or 200)
    assert reminders.dispatch_upcoming(db)['sent'] == 1
    assert reminders.dispatch_upcoming(db)['sent'] == 0
    assert len(sent) == 1 and 'Rent payment' in sent[0]['body']
    assert '12.345' not in sent[0]['body'] and 'Private wallet' not in sent[0]['body']
    assert plan.status == 'planned' and plan.posted_transaction_id is None
    # A rescheduled occurrence is eligible again, but never changes ledger records.
    plan.due_at += timedelta(minutes=1); db.commit()
    assert reminders.dispatch_upcoming(db)['sent'] == 1


def test_failure_logs_identify_stage_without_private_payload(workspace, monkeypatch, caplog):
    client, db, user = workspace
    setup_plan(client, db, user, monkeypatch)
    def fail(*args, **kwargs):
        raise ValueError('private-token private-financial-description')
    monkeypatch.setattr(push, 'send_device', fail)
    with caplog.at_level('WARNING', logger='flowbudget'):
        assert reminders.dispatch_upcoming(db)['failed'] == 1
    assert 'stage=provider type=ValueError' in caplog.text
    for private in ('private-token', 'private-financial-description', 'Rent payment', user.email):
        assert private not in caplog.text


def test_provider_failure_log_contains_only_numeric_status(workspace, monkeypatch, caplog):
    client, db, user = workspace
    setup_plan(client, db, user, monkeypatch)
    monkeypatch.setattr(push, 'send_device', lambda *args, **kwargs: 503)
    with caplog.at_level('WARNING', logger='flowbudget'):
        assert reminders.dispatch_upcoming(db)['failed'] == 1
    assert 'stage=provider status=503' in caplog.text
    assert 'Rent payment' not in caplog.text and user.email not in caplog.text


@pytest.mark.parametrize('change', ['disabled','posted','past','inactive','unrelated','revoked'])
def test_never_sends_ineligible_or_inaccessible_entries(workspace, monkeypatch, change):
    client, db, user = workspace
    body, wallet, plan = setup_plan(client, db, user, monkeypatch)
    if change == 'disabled': plan.reminder_enabled = False
    if change == 'posted': plan.status = 'posted'
    if change == 'past': plan.due_at = datetime(2026, 10, 21, 8)
    if change == 'inactive': user.active = False
    if change in ('unrelated', 'revoked'):
        other = User(username='Other',email='other@reminders.test',password_hash='unused')
        db.add(other); db.flush()
        wallet.user_id = other.id; plan.owner_id = other.id
        if change == 'revoked':
            share = WalletShare(wallet_id=wallet.id,owner_id=other.id,member_user_id=user.id,invitee_email=user.email,permission='view')
            db.add(share); db.flush(); db.delete(share)
    db.commit()
    monkeypatch.setattr(push,'send_device',lambda *args,**kwargs:pytest.fail('Must not notify'))
    assert reminders.dispatch_upcoming(db)['sent'] == 0


def test_device_opt_out_and_timing_validation(workspace, monkeypatch):
    client, db, user = workspace
    body, wallet, plan = setup_plan(client, db, user, monkeypatch)
    body['upcoming'] = {'enabled':False}
    assert client.put('/api/app-updates/push-device',json=body).json()['upcoming'] is False
    monkeypatch.setattr(push,'send_device',lambda *args,**kwargs:pytest.fail('Must not notify'))
    assert reminders.dispatch_upcoming(db)['sent'] == 0
    for invalid in [{'minutes':0},{'minutes':43201},{'days':31},{'time':'25:00'},{'mode':'random'}]:
        assert client.put('/api/app-updates/push-device',json={**body,'upcoming':invalid}).status_code == 422


def test_time_before_and_calendar_month_boundary():
    due = datetime(2027,1,1,0,15)
    assert reminders.reminder_at(due,push.UpcomingPreference(mode='before',minutes=90)) == datetime(2026,12,31,22,45)
    assert reminders.reminder_at(due,push.UpcomingPreference(days=0,time='09:00')) == datetime(2027,1,1,0,10)


def test_expired_browser_subscription_is_removed_without_touching_the_plan(workspace, monkeypatch):
    client, db, user = workspace
    body, wallet, plan = setup_plan(client, db, user, monkeypatch)
    monkeypatch.setattr(push,'send_device',lambda *args,**kwargs:410)
    reminders.dispatch_upcoming(db)
    assert db.get(push.UpdatePushDevice,body['id']) is None
    assert plan.status == 'planned' and plan.posted_transaction_id is None


def test_shared_wallet_reminder_stops_after_access_is_removed(workspace, monkeypatch):
    client, db, user = workspace
    body, wallet, plan = setup_plan(client, db, user, monkeypatch)
    owner = User(username='Space owner', email='space-owner@reminders.test', password_hash='unused')
    db.add(owner); db.flush()
    wallet.user_id = owner.id; plan.owner_id = owner.id
    share = WalletShare(wallet_id=wallet.id, owner_id=owner.id, member_user_id=user.id, invitee_email=user.email, permission='view')
    db.add(share); db.commit()
    monkeypatch.setattr(push,'send_device',lambda *args,**kwargs:200)
    assert reminders.dispatch_upcoming(db)['sent'] == 1
    db.delete(share); plan.due_at += timedelta(minutes=1); db.commit()
    monkeypatch.setattr(push,'send_device',lambda *args,**kwargs:pytest.fail('Access was revoked'))
    assert reminders.dispatch_upcoming(db)['sent'] == 0
