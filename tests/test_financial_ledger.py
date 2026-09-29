from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from fastapi.encoders import jsonable_encoder
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from api.app import app
from api.database import Base, get_db
from api.index import current_user, export_backup
from api.models import Transaction, User, Wallet, WalletBalanceCheck, WalletShare


@pytest.fixture
def ledger_workspace():
    engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        owner = User(username='Owner', email='owner@ledger.test', password_hash='unused')
        member = User(username='Member', email='member@ledger.test', password_hash='unused')
        stranger = User(username='Stranger', email='stranger@ledger.test', password_hash='unused')
        db.add_all([owner, member, stranger])
        db.commit()
        actor = {'user': owner}
        overrides = app.dependency_overrides.copy()
        ready = getattr(app.state, 'storage_ready', False)
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[current_user] = lambda: actor['user']
        app.state.storage_ready = True
        try:
            yield TestClient(app), db, actor, owner, member, stranger
        finally:
            app.dependency_overrides = overrides
            app.state.storage_ready = ready
    engine.dispose()


def wallet(client, db, name, amount):
    response = client.post('/api/wallets', json={'name': name, 'initial_balance': amount})
    assert response.status_code == 201, response.text
    row = db.get(Wallet, response.json()['id'])
    row.created_at = datetime(2026, 8, 1)
    for opening in db.query(Transaction).filter_by(wallet_id=row.id, is_opening_balance=True):
        opening.date = row.created_at
    db.commit()
    return row.id


def transaction(client, wallet_id, kind, amount, date, **extra):
    response = client.post('/api/transactions', json={
        'wallet_id': wallet_id, 'type': kind, 'amount': amount,
        'description': kind.title(), 'date': date, 'reporting_month': '2026-09', **extra,
    })
    assert response.status_code == 201, response.text
    return response.json()


def test_running_balances_include_both_transfer_sides_and_match_wallet_totals(ledger_workspace):
    client, db, _, _, _, _ = ledger_workspace
    cash = wallet(client, db, 'Cash', 100)
    savings = wallet(client, db, 'Savings', 5)
    transaction(client, cash, 'income', 20, '2026-09-01T09:00:00+03:00')
    transaction(client, cash, 'expense', 10, '2026-09-02T09:00:00+03:00')
    transaction(client, cash, 'transfer', 15, '2026-09-03T09:00:00+03:00', transfer_wallet_id=savings)

    cash_data = client.get(f'/api/ledger/wallets/{cash}?limit=2').json()
    assert cash_data['balance'] == 95
    assert [(entry['change'], entry['balance_after']) for entry in cash_data['entries']] == [(-15, 95), (-10, 110)]
    older = client.get(f'/api/ledger/wallets/{cash}', params={**cash_data['next_cursor'], 'limit': 2}).json()
    assert [(entry['change'], entry['balance_after']) for entry in older['entries']] == [(20, 120), (100, 100)]
    assert older['next_cursor'] is None

    savings_data = client.get(f'/api/ledger/wallets/{savings}').json()
    assert savings_data['balance'] == 20
    assert [(entry['change'], entry['balance_after']) for entry in savings_data['entries']] == [(15, 20), (5, 5)]
    assert client.get(f'/api/ledger/wallets/{cash}?before_id=1').status_code == 422


def test_shared_viewer_can_read_redacted_ledger_but_cannot_check_balance(ledger_workspace):
    client, db, actor, owner, member, stranger = ledger_workspace
    shared = wallet(client, db, 'Household', 100)
    private = wallet(client, db, 'Private savings', 0)
    db.add(WalletShare(wallet_id=shared, owner_id=owner.id, invitee_email=member.email,
                       member_user_id=member.id, permission='view'))
    db.commit()
    transaction(client, shared, 'transfer', 5, '2026-09-02T09:00:00+03:00', transfer_wallet_id=private)

    actor['user'] = member
    data = client.get(f'/api/ledger/wallets/{shared}').json()
    assert data['balance'] == 95 and data['can_check'] is False
    assert data['entries'][0]['counterparty'] == 'Another wallet'
    assert 'Private savings' not in str(data)
    assert client.post(f'/api/ledger/wallets/{shared}/checks', json={'observed_balance': 90}).status_code == 403
    actor['user'] = stranger
    assert client.get(f'/api/ledger/wallets/{shared}').status_code == 403
    assert client.get(f'/api/ledger/wallets/{shared}/checks').status_code == 403


def test_checks_preserve_mismatch_history_without_changing_financial_records(ledger_workspace, monkeypatch):
    client, db, actor, owner, member, _ = ledger_workspace
    shared = wallet(client, db, 'Household', 100)
    db.add(WalletShare(wallet_id=shared, owner_id=owner.id, invitee_email=member.email,
                       member_user_id=member.id, permission='edit'))
    db.commit()
    actor['user'] = member
    headers = {'Idempotency-Key': 'balance-check-1'}
    first = client.post(f'/api/ledger/wallets/{shared}/checks', json={'observed_balance': '95.000', 'note': 'Counted cash'}, headers=headers)
    assert first.status_code == 201, first.text
    assert first.json()['difference'] == -5
    assert client.post(f'/api/ledger/wallets/{shared}/checks', json={'observed_balance': '95.000', 'note': 'Counted cash'}, headers=headers).json() == first.json()
    assert db.query(WalletBalanceCheck).count() == 1
    assert db.query(Transaction).filter_by(wallet_id=shared).count() == 1
    assert client.get(f'/api/ledger/wallets/{shared}').json()['balance'] == 100

    added = client.post('/api/shared/transactions', json={
        'wallet_id': shared, 'type': 'expense', 'amount': 5,
        'description': 'Missing receipt', 'date': '2026-09-03T09:00:00+03:00',
    })
    assert added.status_code == 201, added.text
    second = client.post(f'/api/ledger/wallets/{shared}/checks', json={'observed_balance': 95})
    assert second.status_code == 201, second.text
    assert second.json()['matches'] is True
    history = client.get(f'/api/ledger/wallets/{shared}/checks').json()['checks']
    assert [row['difference'] for row in history] == [0, -5]
    assert [row['checked_by'] for row in history] == ['Member', 'Member']
    actor['user'] = owner
    exported = export_backup(owner, db)
    assert len(exported['balance_checks']) == 2
    assert exported['balance_checks'][0]['checked_by_name'] == 'Member'
    monkeypatch.setattr('api.account_security.confirmed', lambda *args: None)
    restored = client.post('/api/backup/restore', json=jsonable_encoder(exported))
    assert restored.status_code == 200, restored.text
    assert restored.json()['ok'] is True
    restored_wallet = db.query(Wallet).filter_by(user_id=owner.id, name='Household').one()
    restored_history = client.get(f'/api/ledger/wallets/{restored_wallet.id}/checks').json()['checks']
    assert [row['difference'] for row in restored_history] == [0, -5]
    assert [row['checked_by'] for row in restored_history] == ['Member', 'Member']
