from datetime import datetime, timedelta
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from api.app import app
from api.database import Base, get_db
from api.index import current_user, export_backup
from api.models import PlannedTransaction, Transaction, User, Wallet, WalletShare, Space, SpaceMember
from api.planned import post_due
from api.timekeeping import now as ledger_now


@pytest.fixture
def workspace():
    engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        owner = User(username='Owner', email='owner@plans.test', password_hash='unused')
        member = User(username='Member', email='member@plans.test', password_hash='unused')
        db.add_all([owner, member]); db.flush()
        wallet = Wallet(user_id=owner.id, name='Home', initial_balance=0)
        db.add(wallet); db.flush()
        db.add(WalletShare(wallet_id=wallet.id, owner_id=owner.id, invitee_email=member.email,
                           member_user_id=member.id, permission='view'))
        db.commit()
        actor = {'user': owner}
        previous = app.dependency_overrides.copy()
        ready = getattr(app.state, 'storage_ready', False)
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[current_user] = lambda: actor['user']
        app.state.storage_ready = True
        try:
            yield TestClient(app), db, actor, owner, member, wallet
        finally:
            app.dependency_overrides = previous
            app.state.storage_ready = ready
    engine.dispose()


def payload(wallet_id, status='scheduled'):
    due = (ledger_now() + timedelta(days=2)).isoformat() + '+03:00'
    return {'status': status, 'reminder_enabled': True, 'transaction': {
        'wallet_id': wallet_id, 'type': 'expense', 'amount': '2.250',
        'description': 'Upcoming bill', 'notes': '', 'date': due,
        'transfer_wallet_id': None, 'category_id': None,
        'recurring_frequency': 'none', 'recurring_until': None}}


def shared_space(db, owner, member, wallet):
    space = Space(owner_id=owner.id, name='Synthetic Space', currency='KWD')
    db.add(space); db.flush()
    wallet.space_id = space.id
    membership = SpaceMember(space_id=space.id, email=member.email,
                             member_user_id=member.id, role='edit')
    db.add(membership); db.commit()
    return space, membership


@pytest.mark.parametrize('scoped', [False, True])
def test_plan_creation_replay_posts_only_one_entry(workspace, scoped):
    client, db, _, owner, member, wallet = workspace
    suffix = ''
    if scoped:
        space, _ = shared_space(db, owner, member, wallet)
        suffix = f'?space_id={space.id}'
    body = payload(wallet.id)
    path = '/api/planned-transactions' + suffix
    headers = {'Idempotency-Key': 'plan-retry'}
    first = client.post(path, json=body, headers=headers)
    assert first.status_code == 201, first.text
    assert client.post(path, json=body, headers=headers).json() == first.json()
    assert client.post(path, json={**body, 'revision': first.json()['revision']}, headers=headers).json() == first.json()
    changed = {**body, 'reminder_enabled': False}
    assert client.post(path, json=changed, headers=headers).status_code == 409
    assert db.query(PlannedTransaction).count() == 1
    plan = db.get(PlannedTransaction, first.json()['id'])
    plan.due_at = ledger_now() - timedelta(minutes=1)
    db.commit()
    # A lost creation response can also be retried after scheduling has completed.
    assert post_due(db) == 1
    replay = client.post(path, json=body, headers=headers)
    assert replay.status_code == 201, replay.text
    assert replay.json() == first.json()
    assert post_due(db) == 0
    assert db.query(Transaction).count() == 1


@pytest.mark.parametrize('scope', ['legacy', 'space-unscoped', 'space-scoped'])
def test_downgraded_creator_cannot_edit_move_or_delete_plan(workspace, scope):
    client, db, actor, owner, member, wallet = workspace
    membership = None
    suffix = ''
    if scope != 'legacy':
        space, membership = shared_space(db, owner, member, wallet)
        if scope == 'space-scoped':
            suffix = f'?space_id={space.id}'
    share = db.query(WalletShare).one()
    share.permission = 'edit'; db.commit()
    actor['user'] = member
    body = payload(wallet.id)
    created = client.post('/api/planned-transactions' + suffix, json=body)
    assert created.status_code == 201, created.text
    row = created.json()
    share.permission = 'view'
    if membership:
        membership.role = 'view'
    db.commit()
    listed = client.get('/api/planned-transactions' + suffix)
    assert listed.status_code == 200, listed.text
    assert listed.json()[0]['can_edit'] is False
    path = f"/api/planned-transactions/{row['id']}" + suffix
    assert client.put(path, json={**body, 'revision': row['revision']}).status_code == 403
    assert client.delete(path, headers={'If-Match': row['revision']}).status_code == 403
    assert db.get(PlannedTransaction, row['id']) is not None
    if scope != 'space-scoped':
        own_wallet = Wallet(user_id=member.id, name='Member personal', initial_balance=0)
        db.add(own_wallet); db.commit()
        moved = payload(own_wallet.id)
        assert client.put(path, json={**moved, 'revision': row['revision']}).status_code == 403


@pytest.mark.parametrize('use_header', [False, True])
def test_plan_revision_rejects_stale_drafts_and_deletes(workspace, use_header):
    client, db, _, _, _, wallet = workspace
    original = payload(wallet.id)
    created = client.post('/api/planned-transactions', json=original).json()
    revision = created['revision']
    assert len(revision) == 64
    assert client.get('/api/planned-transactions').json()[0]['revision'] == revision
    path = f"/api/planned-transactions/{created['id']}"
    missing = client.put(path, json=original)
    assert missing.status_code == 409
    assert missing.json()['detail'] == 'Update or refresh Budgetly, then reopen this planned entry before editing it.'
    changed = {**original, 'transaction': {**original['transaction'], 'amount': '9.000'}}
    options = {'headers': {'If-Match': revision}} if use_header else {}
    if not use_header:
        changed['revision'] = revision
    saved = client.put(path, json=changed, **options)
    assert saved.status_code == 200, saved.text
    assert saved.json()['revision'] != revision
    assert client.put(path, json={**original, 'revision': saved.json()['revision']},
                      headers={'If-Match': revision}).status_code == 409
    stale = {**original, 'revision': revision,
             'transaction': {**original['transaction'], 'notes': 'Stale device notes'}}
    assert client.put(path, json=stale, **options).status_code == 409
    db.expire_all()
    assert db.get(PlannedTransaction, created['id']).amount == Decimal('9.000')
    assert client.delete(path, headers={'If-Match': revision}).status_code == 409
    assert client.delete(path, headers={'If-Match': saved.json()['revision']}).status_code == 204


@pytest.mark.parametrize('role', ['edit', 'add'])
def test_current_shared_creator_can_update_and_delete(workspace, role):
    client, db, actor, _, member, wallet = workspace
    db.query(WalletShare).one().permission = role; db.commit()
    actor['user'] = member
    body = payload(wallet.id)
    created = client.post('/api/planned-transactions', json=body).json()
    assert created['can_edit'] is True
    path = f"/api/planned-transactions/{created['id']}"
    saved = client.put(path, json={**body, 'revision': created['revision'], 'reminder_enabled': False})
    assert saved.status_code == 200, saved.text
    # Legacy clients may still delete without a revision, subject to current permissions.
    assert client.delete(path).status_code == 204


def test_scheduled_plan_posts_once_and_not_before_due(workspace):
    client, db, _, owner, _, wallet = workspace
    response = client.post('/api/planned-transactions', json=payload(wallet.id))
    assert response.status_code == 201, response.text
    plan_id = response.json()['id']
    assert db.query(Transaction).count() == 0
    assert post_due(db) == 0
    plan = db.get(PlannedTransaction, plan_id)
    plan.due_at = ledger_now() - timedelta(minutes=1)
    db.commit()
    assert post_due(db) == 1
    assert post_due(db) == 0
    assert db.query(Transaction).count() == 1
    tx = db.query(Transaction).one()
    assert tx.amount == Decimal('2.250')
    assert tx.user_id == owner.id
    assert db.get(PlannedTransaction, plan_id).posted_transaction_id == tx.id
    assert export_backup(owner, db)['planned_transactions'][0]['status'] == 'posted'


def test_independent_runner_requires_secret_and_posts_once(workspace, monkeypatch):
    client, db, _, _, _, wallet = workspace
    monkeypatch.setenv('SCHEDULE_RUNNER_SECRET', 'test-only-runner-secret')
    plan_id = client.post('/api/planned-transactions', json=payload(wallet.id)).json()['id']
    db.get(PlannedTransaction, plan_id).due_at = ledger_now() - timedelta(minutes=1)
    db.commit()
    path = '/api/maintenance/scheduled-transactions'
    assert client.post(path).status_code == 401
    assert db.query(Transaction).count() == 0
    headers = {'Authorization': 'Bearer test-only-runner-secret'}
    assert client.post(path, headers=headers).json()['scheduled_transactions_posted'] == 1
    assert client.post(path, headers=headers).json()['scheduled_transactions_posted'] == 0
    assert db.query(Transaction).count() == 1


def test_viewer_can_read_but_not_schedule_or_edit(workspace):
    client, _, actor, _, member, wallet = workspace
    owner_response = client.post('/api/planned-transactions', json=payload(wallet.id, 'planned'))
    assert owner_response.status_code == 201
    actor['user'] = member
    listed = client.get('/api/planned-transactions')
    assert listed.status_code == 200
    assert listed.json()[0]['can_edit'] is False
    assert client.post('/api/planned-transactions', json=payload(wallet.id)).status_code == 403
    assert client.delete(f"/api/planned-transactions/{owner_response.json()['id']}").status_code == 403


def test_revoked_shared_access_does_not_post(workspace):
    client, db, actor, _, member, wallet = workspace
    share = db.query(WalletShare).one()
    share.permission = 'add'; db.commit()
    actor['user'] = member
    response = client.post('/api/planned-transactions', json=payload(wallet.id))
    assert response.status_code == 201, response.text
    row = db.get(PlannedTransaction, response.json()['id'])
    row.due_at = ledger_now() - timedelta(minutes=1)
    share.permission = 'view'; db.commit()
    assert post_due(db) == 0
    assert db.query(Transaction).count() == 0
    assert db.get(PlannedTransaction, row.id).status == 'failed'


def test_shared_runner_posts_for_owner_and_notifies_creator_once(workspace, monkeypatch):
    import json
    from uuid import uuid4
    from cryptography.fernet import Fernet
    from api import update_push as push
    client, db, actor, owner, member, wallet = workspace
    monkeypatch.setenv('UPDATE_PUSH_ENCRYPTION_KEY', Fernet.generate_key().decode())
    monkeypatch.setenv('SCHEDULE_RUNNER_SECRET', 'test-runner')
    share = db.query(WalletShare).one()
    share.permission = 'add'
    actor['user'] = member
    device = push.UpdatePushDevice(id=str(uuid4()), user_id=member.id, platform='browser', installed_version='1.0.0',
        payload=push.cipher().encrypt(json.dumps({'credentials': {}, 'updates': False, 'scheduled': True}).encode()).decode())
    db.add(device); db.commit()
    response = client.post('/api/planned-transactions', json=payload(wallet.id))
    assert response.status_code == 201
    plan = db.get(PlannedTransaction, response.json()['id'])
    plan.due_at = ledger_now() - timedelta(minutes=1)
    db.commit()
    calls = []
    monkeypatch.setattr(push, 'send_device', lambda row, version, notice=None: calls.append(notice) or 503)
    headers = {'Authorization': 'Bearer test-runner'}
    result = client.post('/api/maintenance/scheduled-transactions', headers=headers)
    assert result.json()['scheduled_transactions_posted'] == 1
    tx = db.query(Transaction).one()
    assert tx.user_id == owner.id and tx.recorded_by_id == member.id
    assert db.query(push.ScheduledPush).count() == 1
    assert db.query(push.ScheduledPush).one().sent_at is None
    monkeypatch.setattr(push, 'send_device', lambda row, version, notice=None: calls.append(notice) or 200)
    assert client.post('/api/maintenance/scheduled-transactions', headers=headers).json()['notifications']['sent'] == 1
    assert client.post('/api/maintenance/scheduled-transactions', headers=headers).json()['notifications']['sent'] == 0
    assert db.query(Transaction).count() == 1
    assert calls[-1]['body'] == 'Your scheduled expense was recorded.'
    assert 'Upcoming bill' not in json.dumps(calls[-1])


def test_disabled_scheduled_alerts_create_no_outbox(workspace, monkeypatch):
    from uuid import uuid4
    from cryptography.fernet import Fernet
    from api import update_push as push
    client, db, _, owner, _, wallet = workspace
    monkeypatch.setenv('UPDATE_PUSH_ENCRYPTION_KEY', Fernet.generate_key().decode())
    db.add(push.UpdatePushDevice(id=str(uuid4()), user_id=owner.id, platform='android', installed_version='1.0.0',
        payload=push.cipher().encrypt(b'"legacy-token"').decode()))
    db.commit()
    response = client.post('/api/planned-transactions', json=payload(wallet.id))
    plan = db.get(PlannedTransaction, response.json()['id'])
    plan.due_at = ledger_now() - timedelta(minutes=1)
    db.commit()
    assert post_due(db) == 1
    assert db.query(push.ScheduledPush).count() == 0


def test_rating_prompt_stops_after_stars(workspace):
    client, db, actor, owner, _, _ = workspace
    from api.workspace import count_feedback_event
    for _ in range(3):
        count_feedback_event(db, owner.id)
    db.commit()
    assert client.get('/api/feedback/prompt').json()['show'] is True
    response = client.post('/api/feedback/rating', json={'stars': 4, 'comment': ''})
    assert response.status_code == 201, response.text
    assert response.json()['content'] == 'No comment'
    assert client.get('/api/feedback/prompt').json()['show'] is False
