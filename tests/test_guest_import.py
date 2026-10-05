import copy
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from api.database import Base, get_db
from api.guest_import import router
from api.index import current_user, wallet_balance
from api.models import Budget, Category, Transaction, User, Wallet


@pytest.fixture
def workspace():
    engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        user = User(username='Existing', email='existing@guest.test', password_hash='unused')
        db.add(user); db.flush()
        db.add(Wallet(user_id=user.id, name='Existing wallet', initial_balance=0))
        db.commit()
        app = FastAPI(); app.include_router(router)
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[current_user] = lambda: user
        yield TestClient(app), db, user
    engine.dispose()


def payload():
    return {'workspace_id': str(uuid4()), 'revision': 1, 'currency': 'KWD',
        'wallets': [{'id': 1, 'name': 'Main', 'initial_balance': 100, 'opening_date': '2026-10-01T12:00:00'},
                    {'id': 2, 'name': 'Card', 'initial_balance': 0, 'opening_date': '2026-10-01T12:00:00', 'type': 'card', 'color': '#75465f', 'card_network': 'mastercard'}],
        'categories': [{'id': 3, 'name': 'Food', 'kind': 'expense'}],
        'transactions': [{'id': 4, 'type': 'expense', 'amount': 5, 'description': 'Lunch', 'date': '2026-10-05T12:00:00', 'wallet_id': 1, 'category_id': 3},
                         {'id': 5, 'type': 'transfer', 'amount': 10, 'description': 'Move money', 'date': '2026-10-05T13:00:00', 'wallet_id': 1, 'transfer_wallet_id': 2}],
        'budgets': [{'id': 6, 'name': 'Food budget', 'category_id': 3, 'limit_amount': 50, 'start_date': '2026-10-01', 'reporting_month': '2026-10'}]}


def test_additive_atomic_import_and_retry_do_not_duplicate(workspace):
    client, db, user = workspace
    body = payload()
    response = client.post('/api/guest/import', json=body)
    assert response.status_code == 200, response.text
    result = response.json()
    assert client.post('/api/guest/import', json=body).json() == result
    assert db.query(Wallet).count() == 3
    assert db.query(Transaction).count() == 3  # two regular entries + opening funds once
    assert db.query(Budget).count() == 1
    assert wallet_balance(db, db.get(Wallet, result['wallet_map']['1'])) == 85
    assert wallet_balance(db, db.get(Wallet, result['wallet_map']['2'])) == 10
    assert db.query(Wallet).filter_by(name='Existing wallet', user_id=user.id).count() == 1
    assert db.get(Wallet, result['wallet_map']['2']).card_network == 'mastercard'
    changed = copy.deepcopy(body); changed['transactions'][0]['amount'] = 7
    assert client.post('/api/guest/import', json=changed).status_code == 409
    assert db.query(Transaction).count() == 3


@pytest.mark.parametrize('case', ['missing-wallet', 'category-kind', 'duplicate-id', 'recurring', 'income-month', 'currency'])
def test_invalid_import_never_changes_existing_data(workspace, case):
    client, db, _ = workspace
    body = payload()
    if case == 'missing-wallet': body['transactions'][0]['wallet_id'] = 999
    if case == 'category-kind': body['categories'][0]['kind'] = 'income'
    if case == 'duplicate-id': body['wallets'][1]['id'] = 1
    if case == 'recurring': body['transactions'][0]['recurring_frequency'] = 'monthly'
    if case == 'income-month': body['transactions'][0]['type'] = 'income'
    if case == 'currency': body['currency'] = 'USD'
    assert client.post('/api/guest/import', json=body).status_code in {409, 422}
    assert db.query(Wallet).count() == 1
    assert db.query(Transaction).count() == 0
    assert db.query(Category).count() == 0
    assert db.query(Budget).count() == 0


def test_guest_import_requires_real_authentication():
    app = FastAPI(); app.include_router(router)
    assert TestClient(app).post('/api/guest/import', json=payload()).status_code == 401


def test_partial_import_failure_rolls_back_wallets_categories_and_receipt(workspace, monkeypatch):
    from api import guest_import
    from api.models import RequestReceipt
    client, db, _ = workspace
    original = guest_import.set_opening_balance
    calls = []
    def broken(*args):
        calls.append(1)
        if len(calls) == 2:
            raise RuntimeError('simulated database write failure')
        return original(*args)
    monkeypatch.setattr(guest_import, 'set_opening_balance', broken)
    with pytest.raises(RuntimeError):
        client.post('/api/guest/import', json=payload())
    assert db.query(Wallet).count() == 1
    assert db.query(Category).count() == 0
    assert db.query(Transaction).count() == 0
    assert db.query(RequestReceipt).count() == 0


def test_oversized_import_is_rejected_before_financial_writes(workspace):
    client, db, _ = workspace
    assert client.post('/api/guest/import', content=b' ' * 10_000_001).status_code == 413
    assert db.query(Wallet).count() == 1
    assert db.query(Transaction).count() == 0
