from datetime import datetime
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from api.app import app
from api.database import Base, get_db
from api.index import current_user, wallet_balance, ensure_indexes, ensure_note_columns
from api.ledger_accounting import migrate_opening_balances
from api.models import Budget, Category, Transaction, User, Wallet, WalletShare
from api.seed import demo_seed_enabled, seed_database


def test_transaction_undo_is_exact_idempotent_and_owner_scoped(workspace):
    client, db, actor, owner, member = workspace
    personal = wallet(client, 'Undo wallet', 10)
    created = client.post('/api/transactions', json=tx(personal['id'], amount=2)).json()
    deleted = client.delete(f"/api/transactions/{created['id']}?undo=true")
    assert deleted.status_code == 200, deleted.text
    trash_id = deleted.json()['trash_id']
    actor['user'] = member
    assert client.post(f'/api/trash/{trash_id}/restore').status_code == 404
    actor['user'] = owner
    restored = client.post(f'/api/trash/{trash_id}/restore')
    assert restored.status_code == 200, restored.text
    assert client.post(f'/api/trash/{trash_id}/restore').json()['already_restored']
    assert db.query(Transaction).filter_by(wallet_id=personal['id'], is_opening_balance=False).count() == 1


def test_shared_editor_deletion_cannot_grant_owner_trash_access(workspace):
    client, db, actor, owner, member = workspace
    w = wallet(client, 'Editor deletion')
    share(db, w['id'], owner, member)
    created = client.post('/api/shared/transactions', json=tx(w['id'])).json()
    actor['user'] = member
    response = client.delete(f"/api/shared/transactions/{created['id']}?undo=true")
    assert response.status_code == 200
    assert response.json()['trash_id'] is None
    assert client.get('/api/trash').json() == []
    actor['user'] = owner
    item = client.get('/api/trash').json()[0]
    assert client.post(f"/api/trash/{item['id']}/restore").status_code == 200


def test_shared_undo_does_not_duplicate_existing_recurring_children(workspace):
    client, db, actor, owner, member = workspace
    w = wallet(client, 'Shared undo')
    share(db, w['id'], owner, member)
    created = client.post('/api/shared/transactions', json=tx(w['id'], amount=3)).json()
    child = Transaction(user_id=owner.id, wallet_id=w['id'], type='expense', amount=3, description='Existing child', date=datetime(2026, 9, 22), recurring_parent_id=created['id'])
    db.add(child); db.commit()
    result = client.delete(f"/api/shared/transactions/{created['id']}?undo=true")
    assert result.status_code == 200, result.text
    restored = client.post(f"/api/trash/{result.json()['trash_id']}/restore")
    assert restored.status_code == 200, restored.text
    assert db.query(Transaction).filter_by(wallet_id=w['id'], is_opening_balance=False).count() == 2


def test_existing_schema_upgrade_is_repeatable():
    engine = create_engine('sqlite://')
    Base.metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(text('ALTER TABLE transactions DROP COLUMN is_opening_balance'))
        connection.execute(text('ALTER TABLE transactions DROP COLUMN recorded_by_id'))
        ensure_note_columns(connection)
        ensure_note_columns(connection)
        ensure_indexes(connection)
        ensure_indexes(connection)
        assert {'is_opening_balance', 'recorded_by_id'} <= {c['name'] for c in inspect(connection).get_columns('transactions')}
    engine.dispose()


def test_demo_data_is_disabled_by_default_on_vercel(monkeypatch):
    monkeypatch.delenv('BUDGETLY_SEED_DEMO', raising=False)
    monkeypatch.setenv('VERCEL', '1')
    assert demo_seed_enabled() is False
    monkeypatch.setenv('BUDGETLY_SEED_DEMO', 'true')
    assert demo_seed_enabled() is True


def test_non_demo_seed_starts_empty_and_preserves_existing_workspace(workspace, monkeypatch):
    _, db, _, owner, _ = workspace
    monkeypatch.setenv('ADMIN_INITIAL_EMAIL', owner.email)
    seed_database(db, include_demo=False)
    created = db.query(Wallet).filter_by(user_id=owner.id).one()
    assert created.initial_balance == 0
    assert db.query(Transaction).count() == 0
    created.name = 'My existing wallet'
    created.initial_balance = 25
    db.commit()
    seed_database(db, include_demo=False)
    assert db.query(Wallet).filter_by(user_id=owner.id).one().initial_balance == 25
    assert created.name == 'My existing wallet'


def test_analytics_and_calendar_exclude_owned_shared_records(workspace):
    client, db, _, owner, member = workspace
    personal = wallet(client, 'Personal')
    shared = wallet(client, 'Shared')
    share(db, shared['id'], owner, member)
    now = datetime.now().replace(hour=10, minute=0, second=0, microsecond=0)
    client.post('/api/transactions', json=tx(personal['id'], amount=4, date=now.isoformat()))
    shared_row = client.post('/api/shared/transactions', json=tx(shared['id'], amount=7, date=now.isoformat()))
    assert shared_row.status_code == 201, shared_row.text

    analytics = client.get('/api/analytics?months=1').json()
    assert sum(row['expense'] for row in analytics['trend']) == 4
    assert sum(row['value'] for row in analytics['categories']) == 4
    calendar = client.get(f"/api/calendar?year={now.year}&month={now.month}").json()
    assert calendar[now.date().isoformat()]['expense'] == 4


def test_reports_do_not_treat_opening_debt_as_new_spending(workspace):
    client, db, _, _, _ = workspace
    wallet(client, 'Overdraft', -50)
    now = datetime.now().replace(hour=10, minute=0, second=0, microsecond=0)
    db.query(Transaction).update({'date': now}); db.commit()
    report = client.get('/api/analytics?months=1').json()
    assert report['trend'][0]['expense'] == 0
    assert report['categories'] == []
    day = client.get(f'/api/calendar?year={now.year}&month={now.month}').json()[now.date().isoformat()]
    assert day['expense'] == 0 and day['count'] == 1
    assert client.get('/api/calendar?year=0&month=1').status_code == 422


def test_invalid_or_oversized_backup_preserves_existing_records(workspace, monkeypatch):
    from api import account_security, index
    client, db, _, _, _ = workspace
    wallet(client, 'Keep me', 12)
    monkeypatch.setattr(account_security, 'confirmed', lambda *args: None)
    for payload in [[], {'version': 1, 'wallets': 'invalid'}, {'version': 1, 'notes': [None]}]:
        assert client.post('/api/backup/restore', json=payload).status_code == 400
    assert client.post('/api/backup/restore', content='{bad json').status_code == 400
    monkeypatch.setattr(index, 'MAX_BACKUP_BYTES', 100)
    assert client.post('/api/backup/restore', content=' ' * 101).status_code == 413
    assert client.post('/api/backup/restore', content=iter([b' ' * 60, b' ' * 60])).status_code == 413
    assert db.query(Wallet).one().name == 'Keep me'
    assert db.query(Transaction).one().amount == Decimal('12')


@pytest.fixture
def workspace():
    engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        owner = User(username='Owner', email='owner@clarity.test', password_hash='unused')
        member = User(username='Member', email='member@clarity.test', password_hash='unused')
        db.add_all([owner, member]); db.commit()
        actor = {'user': owner}
        old = app.dependency_overrides.copy()
        ready = getattr(app.state, 'storage_ready', False)
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[current_user] = lambda: actor['user']
        app.state.storage_ready = True
        try:
            yield TestClient(app), db, actor, owner, member
        finally:
            app.dependency_overrides = old
            app.state.storage_ready = ready
    engine.dispose()


def wallet(client, name, amount=0):
    response = client.post('/api/wallets', json={'name': name, 'initial_balance': amount})
    assert response.status_code == 201, response.text
    return response.json()


def tx(wallet_id, **changes):
    return {'wallet_id': wallet_id, 'type': 'expense', 'amount': 10, 'description': 'Groceries',
            'date': '2026-09-21T10:00:00+03:00', **changes}


def share(db, wallet_id, owner, member, permission='edit'):
    db.add(WalletShare(wallet_id=wallet_id, owner_id=owner.id, invitee_email=member.email,
                       member_user_id=member.id, permission=permission)); db.commit()


def test_opening_income_is_atomic_idempotent_and_editable_from_wallet(workspace):
    client, db, _, owner, _ = workspace
    payload = {'name': 'Cash', 'initial_balance': 100.125}
    headers = {'Idempotency-Key': 'opening-test'}
    first = client.post('/api/wallets', json=payload, headers=headers)
    second = client.post('/api/wallets', json=payload, headers=headers)
    assert first.status_code == 201, first.text
    assert first.json() == second.json()
    wid = first.json()['id']
    entries = client.get('/api/transactions', params={'wallet_id': wid}).json()
    assert len(entries) == 1
    entry = entries[0]
    assert entry['type'] == 'income' and entry['is_opening_balance']
    assert entry['amount'] == 100.125
    assert wallet_balance(db, db.get(Wallet, wid)) == 100.125
    assert db.get(Wallet, wid).initial_balance == 0
    assert client.put(f'/api/transactions/{entry["id"]}', json=tx(wid), headers={'If-Match': entry['revision']}).status_code == 409
    assert client.delete(f'/api/transactions/{entry["id"]}').status_code == 409
    assert client.post('/api/transactions', json=tx(wid)).status_code == 201
    edited = client.put(f'/api/wallets/{wid}', json={**payload, 'initial_balance': 150.125})
    assert edited.status_code == 200, edited.text
    assert edited.json()['balance'] == 140.125
    assert db.query(Transaction).filter_by(wallet_id=wid, is_opening_balance=True).count() == 1
    assert client.get('/api/wallets').json()[0]['initial_balance'] == 150.125
    assert client.put(f'/api/wallets/{wid}', json={**payload, 'initial_balance': 0}).status_code == 200
    assert wallet_balance(db, db.get(Wallet, wid)) == -10
    assert db.query(Transaction).filter_by(wallet_id=wid, is_opening_balance=True).count() == 0


def test_legacy_conversion_preserves_balances_and_date_on_retries(workspace):
    _, db, _, owner, _ = workspace
    for amount in [Decimal('42.125'), Decimal('-12.250'), Decimal('0')]:
        row = Wallet(user_id=owner.id, name=str(amount), initial_balance=amount, created_at=datetime(2025, 2, 1))
        db.add(row)
    db.commit()
    before = {w.id: wallet_balance(db, w) for w in db.query(Wallet).all()}
    migrate_opening_balances(db); db.commit()
    migrate_opening_balances(db); db.commit()
    assert {w.id: wallet_balance(db, w) for w in db.query(Wallet).all()} == before
    assert db.query(Transaction).count() == 2
    assert all(t.date == datetime(2025, 2, 1) for t in db.query(Transaction).all())


def test_overview_excludes_owned_shared_and_incoming_shared_records(workspace):
    client, db, actor, owner, member = workspace
    personal = wallet(client, 'Private', 100)
    shared = wallet(client, 'Household', 900)
    share(db, shared['id'], owner, member)
    client.post('/api/transactions', json=tx(personal['id']))
    client.post('/api/transactions', json=tx(shared['id'], amount=400))
    client.post('/api/transactions', json=tx(shared['id'], amount=50, type='transfer', transfer_wallet_id=personal['id']))
    db.add(Budget(user_id=owner.id, name='Monthly', limit_amount=100, period='monthly', start_date=datetime(2026, 9, 1).date()))
    for row in db.query(Transaction).filter_by(is_opening_balance=True): row.date = datetime(2026, 9, 1)
    db.commit()
    overview = client.get('/api/dashboard?month=2026-09').json()
    assert overview['income'] == 100 and overview['opening_funds'] == 100
    assert overview['earned_income'] == 0 and overview['expense'] == 10
    assert overview['total_balance'] == 140
    assert overview['shared'] == {'balance': 450, 'wallet_count': 1}
    assert [w['name'] for w in overview['wallets']] == ['Private']
    assert overview['budgets'][0]['spent'] == 10
    assert sum(c['value'] for c in overview['category_spending']) == 10
    assert all(t['wallet_id'] == personal['id'] for t in overview['recent_transactions'])
    assert len(client.get('/api/transactions?scope=personal').json()) == 2
    assert next(w for w in client.get('/api/wallets').json() if w['id'] == shared['id'])['is_shared']
    actor['user'] = member
    assert client.get('/api/dashboard?month=2026-09').json()['total_balance'] == 0
    assert client.get('/api/dashboard?month=2026-09').json()['shared'] == {'balance': 450, 'wallet_count': 1}
    assert client.get('/api/shared/transactions').json()


def test_drilldowns_match_displayed_spending_and_shared_access(workspace):
    client, db, actor, owner, member = workspace
    private = wallet(client, 'Private', -50)
    shared = wallet(client, 'Shared', 100)
    share(db, shared['id'], owner, member)
    for row in db.query(Transaction).all(): row.date = datetime(2026, 9, 1)
    category = Category(user_id=owner.id, name='Food', kind='expense')
    db.add(category); db.commit()
    client.post('/api/transactions', json=tx(private['id'], amount=4))
    client.post('/api/transactions', json=tx(private['id'], amount=6, category_id=category.id))
    report = client.get('/api/dashboard?month=2026-09').json()
    for item in report['category_spending']:
        records = client.get('/api/transactions',params={'scope':'personal','month':'2026-09','tx_type':'expense','category_id':item['id'],'exclude_opening':True}).json()
        assert sum(row['amount'] for row in records) == item['value']
        assert all(not row['is_opening_balance'] for row in records)
    actor['user'] = member
    assert client.get('/api/dashboard').json()['shared']['balance'] == 100
    db.query(WalletShare).delete(); db.commit()
    assert client.get('/api/dashboard').json()['shared'] == {'balance':0,'wallet_count':0}


def test_shared_wallet_correction_updates_both_balances_and_attribution(workspace):
    client, db, actor, owner, member = workspace
    first = wallet(client, 'Wrong shared wallet', 100)
    share(db, first['id'], owner, member)
    actor['user'] = member
    second = wallet(client, 'Correct shared wallet', 200)
    share(db, second['id'], member, owner)
    created = client.post('/api/shared/transactions', json=tx(first['id']))
    assert created.status_code == 201, created.text
    record = created.json()
    assert record['recorded_by_name'] == 'Member'
    changed = client.put(f'/api/shared/transactions/{record["id"]}', json=tx(second['id']), headers={'If-Match': record['revision']})
    assert changed.status_code == 200, changed.text
    assert changed.json()['recorded_by_name'] == 'Member'
    assert db.get(Transaction, record['id']).user_id == member.id
    assert wallet_balance(db, db.get(Wallet, first['id'])) == 100
    assert wallet_balance(db, db.get(Wallet, second['id'])) == 190
    assert client.put(f'/api/shared/transactions/{record["id"]}', json=tx(first['id']), headers={'If-Match': record['revision']}).status_code == 409


@pytest.mark.parametrize('permission', ['view', 'add'])
def test_wallet_move_requires_edit_access_at_destination(workspace, permission):
    client, db, actor, owner, member = workspace
    source = wallet(client, 'Source')
    destination = wallet(client, 'Destination')
    share(db, source['id'], owner, member)
    share(db, destination['id'], owner, member, permission)
    record = client.post('/api/shared/transactions', json=tx(source['id'])).json()
    actor['user'] = member
    result = client.put(f'/api/shared/transactions/{record["id"]}', json=tx(destination['id']), headers={'If-Match': record['revision']})
    assert result.status_code == 403
    assert db.get(Transaction, record['id']).wallet_id == source['id']


def test_shared_category_filter_and_negative_opening_are_not_spending(workspace):
    client, db, actor, owner, member = workspace
    private = wallet(client, 'Overdraft', -50)
    category = Category(user_id=owner.id, name='Food', kind='expense')
    db.add(category); db.commit()
    for row in db.query(Transaction).all(): row.date = datetime(2026, 9, 1)
    db.commit()
    overview = client.get('/api/dashboard?month=2026-09').json()
    assert overview['expense'] == 0 and overview['opening_debt'] == 50
    assert overview['total_balance'] == -50
    share(db, private['id'], owner, member)
    client.post('/api/shared/transactions', json=tx(private['id'], category_id=category.id))
    client.post('/api/shared/transactions', json=tx(private['id'], description='Other'))
    rows = client.get('/api/shared/transactions', params={'category_id': category.id}).json()
    assert len(rows) == 1 and rows[0]['category_name'] == 'Food'
