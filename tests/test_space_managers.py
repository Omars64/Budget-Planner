"""Space roles govern every ledger action, independent of legacy wallet grants."""
import base64
import io
from datetime import timedelta

import pytest
from PIL import Image
from sqlalchemy.orm import Session

from api.models import SpaceMember, WalletShare, PlannedTransaction, Transaction, User
from api.spaces import migrate_shared_wallets
from api.timekeeping import now
from tests.test_spaces import spaces, transaction  # noqa: F401


def test_manager_edits_and_deletes_owner_and_own_transactions(spaces):
    client, engine, actor, ids = spaces
    scope = f"?space_id={ids['space']}"
    owner_entry = client.post('/api/transactions' + scope, json=transaction(ids['wallet'])).json()
    actor['id'] = ids['member']
    own = client.post('/api/transactions' + scope, json=transaction(ids['wallet'])).json()
    actor['id'] = ids['owner']
    edited_by_owner = client.put(f"/api/transactions/{own['id']}" + scope,
        headers={'If-Match': own['revision']}, json=transaction(ids['wallet'], description='Owner correction'))
    assert edited_by_owner.status_code == 200, edited_by_owner.text
    actor['id'] = ids['member']
    for entry in (owner_entry, own):
        current = next(row for row in client.get('/api/transactions' + scope).json() if row['id'] == entry['id'])
        result = client.put(f"/api/transactions/{entry['id']}" + scope,
            headers={'If-Match': current['revision']},
            json=transaction(ids['wallet'], description='Manager corrected', amount='3.125'))
        assert result.status_code == 200, result.text
        assert result.json()['description'] == 'Manager corrected'
        stale = client.put(f"/api/transactions/{entry['id']}" + scope,
            headers={'If-Match': current['revision']}, json=transaction(ids['wallet']))
        assert stale.status_code == 409
        assert client.delete(f"/api/transactions/{entry['id']}" + scope).status_code == 204
    with Session(engine) as db:
        assert db.get(Transaction, ids['tx']) is not None


@pytest.mark.parametrize('mirror', ['missing', 'view', 'add'])
def test_manager_does_not_depend_on_old_wallet_grants(spaces, mirror):
    client, engine, actor, ids = spaces
    with Session(engine) as db:
        share = db.query(WalletShare).one()
        if mirror == 'missing':
            db.delete(share)
        else:
            share.permission = mirror
        db.commit()
    actor['id'] = ids['member']
    scope = f"?space_id={ids['space']}"
    wallets = client.get('/api/shared/wallets' + scope)
    assert wallets.status_code == 200, wallets.text
    assert wallets.json()[0]['can_edit'] is True
    record = client.get('/api/transactions' + scope).json()[0]
    result = client.put(f"/api/transactions/{record['id']}" + scope,
        headers={'If-Match': record['revision']}, json=transaction(ids['wallet']))
    assert result.status_code == 200, result.text
    assert client.delete(f"/api/transactions/{record['id']}" + scope).status_code == 204


@pytest.mark.parametrize('role', ['view', None])
def test_old_edit_grant_cannot_bypass_viewer_or_removed_membership(spaces, role):
    client, engine, actor, ids = spaces
    with Session(engine) as db:
        member = db.query(SpaceMember).one()
        if role is None:
            db.delete(member)
        else:
            member.role = role
        db.commit()
    actor['id'] = ids['member']
    scope = f"?space_id={ids['space']}"
    assert client.post('/api/transactions' + scope, json=transaction(ids['wallet'])).status_code == 403
    assert client.delete(f"/api/transactions/{ids['tx']}" + scope).status_code == 403
    unscoped = client.get('/api/shared/wallets').json()
    if role is None:
        assert unscoped == []
    else:
        assert unscoped[0]['can_edit'] is False


def test_legacy_contributors_migrate_without_changing_records(spaces):
    client, engine, actor, ids = spaces
    with Session(engine) as db:
        db.query(SpaceMember).one().role = 'add'
        db.query(WalletShare).one().permission = 'add'
        db.commit()
    for _ in range(2):
        with engine.begin() as connection:
            migrate_shared_wallets(connection)
    with Session(engine) as db:
        assert db.query(SpaceMember).one().role == 'edit'
        assert db.query(WalletShare).one().permission == 'edit'
        assert db.get(Transaction, ids['tx']).description == 'Existing shared expense'
    actor['id'] = ids['member']
    assert client.get('/api/spaces').json()[0]['role'] == 'edit'


def test_manager_manages_wallet_category_budget_and_upcoming(spaces):
    client, _, actor, ids = spaces
    scope = f"?space_id={ids['space']}"
    actor['id'] = ids['member']
    for resource, original, changed in [
        ('categories', {'name':'Manager category','kind':'expense'}, {'name':'Renamed category','kind':'expense'}),
        ('budgets', {'name':'Manager budget','limit_amount':'20','period':'monthly','start_date':'2026-10-01'},
                    {'name':'Renamed budget','limit_amount':'25','period':'monthly','start_date':'2026-10-01'}),
        ('wallets', {'name':'Manager wallet','type':'cash','initial_balance':0},
                    {'name':'Renamed wallet','type':'cash','initial_balance':0}),
    ]:
        created = client.post('/api/' + resource + scope, json=original)
        assert created.status_code == 201, created.text
        path = f"/api/{resource}/{created.json()['id']}" + scope
        edited = client.put(path, json=changed)
        assert edited.status_code == 200, edited.text
        deleted = client.delete(path)
        assert deleted.status_code == 204, deleted.text
    actor['id'] = ids['owner']
    payload = {'transaction':transaction(ids['wallet'],date=(now()+timedelta(days=3)).isoformat()),'status':'scheduled'}
    plan = client.post('/api/planned-transactions' + scope, json=payload)
    assert plan.status_code == 201, plan.text
    actor['id'] = ids['member']
    path = f"/api/planned-transactions/{plan.json()['id']}" + scope
    edited = client.put(path, json=payload)
    assert edited.status_code == 200, edited.text
    assert client.delete(path).status_code == 204
    assert client.put(f"/api/spaces/{ids['space']}/members",json={'email':'other@example.com','role':'edit'}).status_code == 403


def test_manager_receipts_use_regular_and_shared_routes(spaces):
    client, _, actor, ids = spaces
    actor['id'] = ids['member']
    image = io.BytesIO()
    Image.new('RGB', (2, 2)).save(image, format='PNG')
    payload = {'name':'Receipt.png', 'image':'data:image/png;base64,'+base64.b64encode(image.getvalue()).decode()}
    for prefix in ('/api/transactions', '/api/shared/transactions'):
        path = f"{prefix}/{ids['tx']}/receipt?space_id={ids['space']}"
        assert client.get(path).status_code == 200
        result = client.put(path, json=payload)
        assert result.status_code == 200, result.text
        assert client.get(path).json()['image'] == payload['image']
        assert client.delete(path).status_code == 204


def test_manager_scheduled_posting_without_legacy_grant(spaces):
    from api.planned import post_due
    _, engine, _, _ = spaces
    with Session(engine) as db:
        db.query(WalletShare).delete()
        plan = db.query(PlannedTransaction).one()
        plan.due_at = now()-timedelta(minutes=1)
        db.commit()
        assert post_due(db) == 1
        assert plan.status == 'posted'


@pytest.mark.parametrize('role', ['view', None])
def test_scheduled_posting_rechecks_current_space_role(spaces, role):
    from api.planned import post_due
    _, engine, _, _ = spaces
    with Session(engine) as db:
        member = db.query(SpaceMember).one()
        if role is None:
            db.delete(member)
        else:
            member.role = role
        plan = db.query(PlannedTransaction).one()
        plan.due_at = now()-timedelta(minutes=1)
        db.commit()
        assert post_due(db) == 0
        assert plan.status == 'failed'
        assert db.query(Transaction).count() == 1


def test_admin_without_membership_has_no_space_access(spaces):
    client, engine, actor, ids = spaces
    with Session(engine) as db:
        db.get(User, ids['outsider']).role = 'admin'
        db.commit()
    actor['id'] = ids['outsider']
    assert client.get(f"/api/transactions?space_id={ids['space']}").status_code == 403


def test_forward_migration_upgrades_only_space_contributors(spaces):
    from alembic import command
    from alembic.config import Config
    from pathlib import Path
    from sqlalchemy import text
    _, engine, _, ids = spaces
    config = Config(str(Path(__file__).resolve().parents[1] / 'alembic.ini'))
    with engine.begin() as connection:
        config.attributes['connection'] = connection
        command.stamp(config, 'f43c912ab706')
        connection.execute(text("UPDATE space_members SET role='add'"))
        connection.execute(text("UPDATE wallet_shares SET permission='add'"))
        connection.execute(WalletShare.__table__.insert().values(wallet_id=ids['private'], owner_id=ids['owner'],
            invitee_email='other@example.com', member_user_id=ids['outsider'], permission='add'))
        before = connection.execute(Transaction.__table__.select()).mappings().all()
        command.upgrade(config, 'head')
        assert connection.execute(text('SELECT role FROM space_members')).scalar_one() == 'edit'
        grants = dict(connection.execute(text('SELECT wallet_id, permission FROM wallet_shares')).all())
        assert grants == {ids['private']: 'add', ids['wallet']: 'edit'}
        assert connection.execute(Transaction.__table__.select()).mappings().all() == before


def test_legacy_wallet_api_cannot_change_space_membership(spaces):
    client, engine, _, ids = spaces
    response = client.post(f"/api/shared/wallets/{ids['wallet']}/shares", json={'email':'other@example.com','permission':'edit'})
    assert response.status_code == 403, response.text
    with Session(engine) as db:
        share_id = db.query(WalletShare).one().id
    assert client.delete(f'/api/shared/shares/{share_id}').status_code == 403
