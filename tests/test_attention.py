from datetime import timedelta
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from api.app import app
from api.database import Base, get_db
from api.index import current_user
from api.models import Budget, Category, Debt, Goal, PlannedTransaction, Transaction, User, Wallet
from api.timekeeping import now


@pytest.fixture
def setup(monkeypatch):
    engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    monkeypatch.setattr(app.state, 'storage_ready', True, raising=False)
    with Session(engine) as db:
        user = User(username='Attention', email='attention-test@example.com', password_hash='unused')
        db.add(user)
        db.flush()
        wallet = Wallet(user_id=user.id, name='Main', initial_balance=100)
        category = Category(user_id=user.id, name='Food', kind='expense')
        db.add_all([wallet, category])
        db.commit()
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[current_user] = lambda: user
        client = TestClient(app)
        yield client, db, user, wallet, category
        client.close()
        app.dependency_overrides.clear()
    engine.dispose()


def test_attention_aggregates_actionable_items_without_mutating_records(setup):
    client, db, user, wallet, category = setup
    current = now()
    plan = PlannedTransaction(owner_id=user.id, created_by_id=user.id, wallet_id=wallet.id,
                              type='expense', amount=Decimal('12.500'), description='Rent',
                              due_at=current - timedelta(days=1), status='failed', error='Wallet needs review')
    budget = Budget(user_id=user.id, name='Food limit', category_id=category.id, limit_amount=100,
                    start_date=current.date().replace(day=1), notify_threshold=80)
    transaction = Transaction(user_id=user.id, type='expense', amount=90, description='Dinner',
                              date=current, reporting_month=current.strftime('%Y-%m'), wallet_id=wallet.id,
                              category_id=category.id)
    debt = Debt(user_id=user.id, name='Car loan', kind='owed', principal=500, remaining=250,
                due_date=current.date() + timedelta(days=3), minimum_payment=50)
    goal = Goal(user_id=user.id, name='Holiday', target_amount=1000, current_amount=100,
                deadline=current.date() + timedelta(days=20))
    db.add_all([plan, budget, transaction, debt, goal])
    db.commit()

    result = client.get('/api/attention')
    assert result.status_code == 200, result.text
    payload = result.json()
    titles = {row['title'] for row in payload['items']}
    assert 'Fix upcoming record' in titles
    assert 'Food limit needs attention' in titles
    assert 'Debt payment coming up' in titles
    assert 'Goal deadline coming up' in titles
    assert payload['items'][0]['severity'] == 'danger'
    assert db.get(PlannedTransaction, plan.id).status == 'failed'
    assert db.query(Transaction).count() == 1


def test_attention_does_not_leak_other_users_or_future_items(setup):
    client, db, user, wallet, _ = setup
    other = User(username='Other', email='attention-other@example.com', password_hash='unused')
    db.add(other)
    db.flush()
    other_wallet = Wallet(user_id=other.id, name='Private', initial_balance=0)
    db.add(other_wallet)
    db.flush()
    db.add(PlannedTransaction(owner_id=other.id, created_by_id=other.id, wallet_id=other_wallet.id,
                              type='expense', amount=10, description='Private',
                              due_at=now() - timedelta(days=1), status='failed', error='Private item'))
    db.add(PlannedTransaction(owner_id=user.id, created_by_id=user.id, wallet_id=wallet.id,
                              type='expense', amount=10, description='Later',
                              due_at=now() + timedelta(days=2), status='planned'))
    db.commit()

    result = client.get('/api/attention')
    assert result.status_code == 200
    assert all('Private' not in row['detail'] for row in result.json()['items'])
    assert all('Later' not in row['detail'] for row in result.json()['items'])
