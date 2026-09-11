from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from api.app import app
from api.database import Base, get_db
from api.index import current_user
from api.models import AppSetting, Transaction, User, Wallet, WalletShare
from api.timekeeping import ledger_time


@pytest.fixture
def ledger():
    engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        owner = User(username='Owner', email='ledger-owner@example.com', password_hash='unused')
        member = User(username='Member', email='ledger-member@example.com', password_hash='unused')
        db.add_all([owner, member])
        db.flush()
        wallets = [Wallet(user_id=owner.id, name=name) for name in ['Main', 'Holiday', 'Private']]
        db.add_all(wallets)
        db.flush()
        for wallet in wallets[:2]:
            db.add(WalletShare(wallet_id=wallet.id, owner_id=owner.id, invitee_email=member.email, member_user_id=member.id, permission='view'))

        def transaction(description, timestamp, wallet=0, destination=None):
            tx = Transaction(user_id=owner.id, wallet_id=wallets[wallet].id,
                             transfer_wallet_id=wallets[destination].id if destination is not None else None,
                             type='transfer' if destination is not None else 'expense', amount=10,
                             description=description, date=ledger_time(datetime.fromisoformat(timestamp)))
            db.add(tx)
            return tx

        transaction('Before month', '2026-08-31T20:59:59+00:00')
        first = transaction('September start', '2026-08-31T21:00:00+00:00')
        transfer = transaction('September transfer', '2026-09-10T12:00:00', destination=1)
        last = transaction('September end', '2026-09-30T20:59:59+00:00')
        holiday = transaction('Holiday expense', '2026-09-12T12:00:00', wallet=1)
        transaction('Private expense', '2026-09-12T12:00:00', wallet=2)
        for i in range(260):
            transaction(f'October {i}', '2026-09-30T21:00:00+00:00')
        db.commit()
        actor = {'user': owner}
        previous = app.dependency_overrides.copy()
        ready = getattr(app.state, 'storage_ready', False)
        app.state.storage_ready = True
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[current_user] = lambda: actor['user']
        try:
            yield TestClient(app), actor, member, wallets, [first.id, transfer.id, last.id], holiday.id, db
        finally:
            app.dependency_overrides = previous
            app.state.storage_ready = ready
    engine.dispose()


@pytest.mark.parametrize('endpoint', ['/api/transactions', '/api/shared/transactions'])
def test_month_wallet_order_and_pages(ledger, endpoint):
    client, _, _, wallets, expected, _, _ = ledger
    params = {'month': '2026-09', 'wallet_id': wallets[0].id, 'sort': 'oldest', 'limit': 2}
    first = client.get(endpoint, params=params)
    assert first.status_code == 200, first.text
    assert [row['id'] for row in first.json()] == expected[:2]
    assert [row['id'] for row in client.get(endpoint, params={**params, 'offset': 2}).json()] == expected[2:]
    assert [row['id'] for row in client.get(endpoint, params={**params, 'sort': 'newest', 'limit': 100}).json()] == expected[::-1]
    assert len(client.get(endpoint, params={'month': '2026-10', 'limit': 100, 'offset': 200}).json()) == 60
    assert client.get(endpoint, params={'month': '2026-07'}).json() == []


def test_shared_destination_filter_and_access(ledger):
    client, actor, member, wallets, expected, holiday, _ = ledger
    actor['user'] = member
    params = {'month': '2026-09', 'wallet_id': wallets[1].id, 'sort': 'oldest'}
    rows = client.get('/api/shared/transactions', params=params).json()
    assert [row['id'] for row in rows] == [expected[1], holiday]
    assert all(not row['can_edit'] for row in rows)
    assert client.get('/api/transactions', params=params).json() == []
    assert client.get('/api/shared/transactions', params={'wallet_id': wallets[2].id}).status_code == 403
    assert len(client.get('/api/shared/transactions', params={**params, 'tx_type': 'transfer', 'search': 'September'}).json()) == 1


@pytest.mark.parametrize('endpoint', ['/api/transactions', '/api/shared/transactions'])
@pytest.mark.parametrize('params', [{'month': '2026-13'}, {'month': 'bad'}, {'sort': 'random'}, {'offset': -1}])
def test_invalid_filters_rejected(ledger, endpoint, params):
    assert ledger[0].get(endpoint, params=params).status_code == 422


def test_existing_default_brand_and_custom_workspace_names(ledger):
    client, actor, _, _, _, _, db = ledger
    name = AppSetting(user_id=actor['user'].id, key='display_name', value='FlowBudget')
    db.add(name)
    db.commit()
    assert client.get('/api/settings').json()['display_name'] == 'Budgetly'
    name.value = 'Family budget'
    db.commit()
    assert client.get('/api/settings').json()['display_name'] == 'Family budget'
