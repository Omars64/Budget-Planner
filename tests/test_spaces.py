from datetime import datetime, timedelta
from decimal import Decimal

import pytest
from fastapi import Depends
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from api.app import app
from api.database import Base, get_db
from api.index import current_user, export_backup
from api.models import User, Wallet, WalletShare, Transaction, PlannedTransaction, TransactionReceipt, Space, SpaceMember, Budget
from api.spaces import migrate_shared_wallets
from api.timekeeping import now


@pytest.fixture
def spaces():
    engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    @event.listens_for(engine, 'connect')
    def foreign_keys(connection, _):
        connection.execute('PRAGMA foreign_keys=ON')
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        owner = User(username='Omar owner', email='omarsolanki46@gmail.com', password_hash='unused', role='admin')
        member = User(username='Omar member', email='omarsolanki35@gmail.com', password_hash='unused')
        outsider = User(username='Outsider', email='other@example.com', password_hash='unused')
        db.add_all([owner, member, outsider]); db.flush()
        owner_id, member_id, outsider_id = owner.id, member.id, outsider.id
        private = Wallet(user_id=owner.id, name='Private', initial_balance=Decimal('10'))
        shared = Wallet(user_id=owner.id, name='Home card', initial_balance=Decimal('25'), color='#267d75', card_network='visa')
        db.add_all([private, shared]); db.flush()
        private_id, shared_id = private.id, shared.id
        db.add(WalletShare(wallet_id=shared.id, owner_id=owner.id, invitee_email=member.email, member_user_id=member.id, permission='edit'))
        transaction = Transaction(user_id=owner.id, recorded_by_id=member.id, wallet_id=shared.id, amount=Decimal('1.250'), type='expense', description='Existing shared expense', date=now(), reporting_month=now().strftime('%Y-%m'))
        db.add(transaction); db.flush()
        tx_id = transaction.id
        db.add(TransactionReceipt(transaction_id=tx_id, name='Kept receipt', image='kept-original-image'))
        db.add(PlannedTransaction(owner_id=owner.id, created_by_id=member.id, wallet_id=shared.id, type='expense', amount=Decimal('0.001'), description='Scheduled', due_at=now()+timedelta(days=2), status='scheduled'))
        db.commit()
    with engine.begin() as connection:
        migrate_shared_wallets(connection)
    with Session(engine) as db:
        space_id = db.scalar(select(Space.id))
    actor = {'id': owner_id}
    def database():
        with Session(engine) as db:
            yield db
    def authenticated(db=Depends(get_db)):
        return db.get(User, actor['id'])
    old = app.dependency_overrides.copy()
    ready = getattr(app.state, 'storage_ready', False)
    app.dependency_overrides[get_db] = database
    app.dependency_overrides[current_user] = authenticated
    app.state.storage_ready = True
    try:
        yield TestClient(app), engine, actor, {'owner': owner_id, 'member': member_id, 'outsider': outsider_id, 'space': space_id, 'private': private_id, 'wallet': shared_id, 'tx': tx_id}
    finally:
        app.dependency_overrides = old
        app.state.storage_ready = ready
        engine.dispose()


def transaction(wallet_id, **values):
    return {'type':'expense','amount':'2.250','description':'Space groceries','date':now().isoformat(), 'wallet_id':wallet_id,'category_id':None,'transfer_wallet_id':None,'recurring_frequency':'none','recurring_until':None, **values}


def test_migration_keeps_original_records_permissions_and_receipt(spaces):
    client, engine, actor, ids = spaces
    for user_id in (ids['owner'], ids['member']):
        actor['id'] = user_id
        result = client.get('/api/spaces').json()
        assert len(result) == 1
        assert result[0]['name'] == 'Home Expense'
        assert result[0]['members'][1]['email'] == 'omarsolanki35@gmail.com'
        records = client.get(f"/api/transactions?space_id={ids['space']}&scope=personal").json()
        assert [row['id'] for row in records] == [ids['tx']]
    with engine.begin() as connection:
        migrate_shared_wallets(connection)
    with Session(engine) as db:
        assert db.query(Space).count() == 1
        assert db.get(Wallet, ids['private']).space_id is None
        assert db.get(Transaction, ids['tx']).recorded_by_id == ids['member']
        assert db.get(TransactionReceipt, ids['tx']).image == 'kept-original-image'
        assert db.query(WalletShare).one().permission == 'edit'
        assert db.query(PlannedTransaction).one().created_by_id == ids['member']


def test_personal_and_space_balances_and_writes_are_isolated(spaces):
    client, engine, actor, ids = spaces
    personal = client.get('/api/wallets?space_id=personal').json()
    assert [row['id'] for row in personal] == [ids['private']]
    actor['id'] = ids['member']
    wallets = client.get(f"/api/wallets?space_id={ids['space']}").json()
    assert [row['id'] for row in wallets] == [ids['wallet']]
    assert wallets[0]['balance'] == 23.75
    assert client.get(f"/api/dashboard?space_id={ids['space']}").json()['total_balance'] == 23.75
    created = client.post(f"/api/transactions?space_id={ids['space']}", json=transaction(ids['wallet']))
    assert created.status_code == 201, created.text
    assert client.post(f"/api/transactions?space_id={ids['space']}", json=transaction(ids['private'])).status_code == 400
    assert client.post(f"/api/transactions?space_id={ids['space']}", json=transaction(ids['wallet'], type='transfer', transfer_wallet_id=ids['private'])).status_code == 400
    assert client.put(f"/api/wallets/{ids['private']}?space_id={ids['space']}", json={'name':'Leaked','type':'cash','initial_balance':0}).status_code == 404
    with Session(engine) as db:
        row = db.get(Transaction, created.json()['id'])
        assert row.user_id == ids['owner'] and row.recorded_by_id == ids['member']
        assert db.get(Wallet, ids['private']).name == 'Private'


def test_roles_palette_revocation_and_no_admin_bypass(spaces):
    client, _, actor, ids = spaces
    actor['id'] = ids['outsider']
    assert client.get('/api/spaces').json() == []
    assert client.get(f"/api/wallets?space_id={ids['space']}").status_code == 403
    actor['id'] = ids['owner']
    assert client.put(f"/api/spaces/{ids['space']}",json={'name':'Home Expense','color':'#123456','currency':'KWD'}).status_code == 422
    for role in ('view', 'add', 'edit'):
        result = client.put(f"/api/spaces/{ids['space']}/members", json={'email':'omarsolanki35@gmail.com','role':role})
        assert result.status_code == 200, result.text
        actor['id'] = ids['member']
        assert client.post(f"/api/transactions?space_id={ids['space']}",json=transaction(ids['wallet'])).status_code == (403 if role == 'view' else 201)
        assert client.post(f"/api/budgets?space_id={ids['space']}",json={'name':'Home budget','limit_amount':'20','period':'monthly','start_date':'2026-10-01'}).status_code == (201 if role == 'edit' else 403)
        assert client.put(f"/api/spaces/{ids['space']}",json={'name':'Change','color':'blue','currency':'KWD'}).status_code == 403
        actor['id'] = ids['owner']
    assert client.delete(f"/api/spaces/{ids['space']}/members/omarsolanki35@gmail.com").status_code == 200
    actor['id'] = ids['member']
    assert client.get('/api/spaces').json() == []
    assert client.get(f"/api/transactions?space_id={ids['space']}").status_code == 403


def test_new_space_starts_empty_and_new_wallet_copies_members(spaces):
    client, _, actor, ids = spaces
    response = client.post('/api/spaces',json={'name':'Holiday','color':'pink','currency':'USD'})
    assert response.status_code == 201, response.text
    new_id = response.json()['id']
    assert client.get(f'/api/wallets?space_id={new_id}').json() == []
    assert client.put(f'/api/spaces/{new_id}/members',json={'email':'omarsolanki35@gmail.com','role':'add'}).status_code == 200
    wallet = client.post(f'/api/wallets?space_id={new_id}',json={'name':'Trip card','type':'bank','initial_balance':25,'color':'#3158aa','card_network':'mastercard'})
    assert wallet.status_code == 201, wallet.text
    actor['id'] = ids['member']
    response = client.get(f'/api/wallets?space_id={new_id}')
    assert response.status_code == 200, response.text
    assert response.json()[0]['card_network'] == 'mastercard'
    assert response.json()[0]['balance'] == 25
    assert client.get(f'/api/transactions?space_id={ids["space"]}').json()[0]['id'] == ids['tx']


def test_backup_includes_membership_without_scoped_recovery_leak(spaces):
    client, engine, _, ids = spaces
    response = client.get('/api/backup')
    assert response.status_code == 200, response.text
    archive = response.json()
    assert archive['spaces'][0]['name'] == 'Home Expense'
    assert archive['spaces'][0]['members'][0]['role'] == 'edit'
    assert len(archive['wallets']) == 2
    with Session(engine) as db:
        full = export_backup(db.get(User, ids['owner']), db)
        assert len(full['wallets']) == 2


def test_backup_restore_preserves_space_access(spaces, monkeypatch):
    import api.account_security as security
    monkeypatch.setattr(security, 'confirmed', lambda *_: None)
    client, engine, actor, ids = spaces
    # The migration identity test above uses an opaque receipt marker rather than
    # image bytes. This restore test has no image attachment to validate.
    with Session(engine) as db:
        db.query(TransactionReceipt).delete()
        db.commit()
    archive = client.get('/api/backup').json()
    restored = client.post('/api/backup/restore', json=archive)
    assert restored.status_code == 200, restored.text
    actor['id'] = ids['member']
    wallets = client.get(f"/api/wallets?space_id={ids['space']}")
    assert wallets.status_code == 200, wallets.text
    assert len(wallets.json()) == 1
    assert wallets.json()[0]['name'] == 'Home card'
    assert wallets.json()[0]['balance'] == 23.75


def test_backup_rejects_foreign_space_before_replacing_records(spaces, monkeypatch):
    import api.account_security as security
    monkeypatch.setattr(security, 'confirmed', lambda *_: None)
    client, _, _, ids = spaces
    archive = client.get('/api/backup').json()
    archive['wallets'][0]['space_id'] = 999999
    result = client.post('/api/backup/restore', json=archive)
    assert result.status_code == 400, result.text
    assert client.get('/api/wallets?space_id=personal').json()[0]['id'] == ids['private']


def test_migration_never_combines_different_access_groups(spaces):
    client, engine, actor, ids = spaces
    with Session(engine) as db:
        separate = Wallet(user_id=ids['owner'], name='View-only shared wallet', initial_balance=0)
        db.add(separate); db.flush()
        db.add(WalletShare(wallet_id=separate.id, owner_id=ids['owner'], invitee_email='omarsolanki35@gmail.com', member_user_id=ids['member'], permission='view'))
        db.commit()
    with engine.begin() as connection:
        migrate_shared_wallets(connection)
    actor['id'] = ids['member']
    result = client.get('/api/spaces').json()
    assert len(result) == 2
    assert {space['role'] for space in result} == {'view', 'edit'}
    for space in result:
        wallets = client.get(f"/api/wallets?space_id={space['id']}").json()
        assert len(wallets) == 1


def test_account_wide_reminders_do_not_change_selected_scope(spaces):
    client, _, actor, ids = spaces
    actor['id'] = ids['member']
    response = client.get('/api/planner/reminders?space_id=')
    assert response.status_code == 200, response.text
    assert isinstance(response.json()['items'], list)
    assert client.get(f"/api/wallets?space_id={ids['space']}").json()[0]['id'] == ids['wallet']
