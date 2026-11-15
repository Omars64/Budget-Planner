from copy import deepcopy
from datetime import datetime
from decimal import Decimal
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from api.app import app
from api.auth_dependency import current_user
from api.database import Base, get_db
from api.models import Space, Transaction, User, Wallet


def test_debt_workspace_is_private_and_links_one_personal_transaction(monkeypatch):
    monkeypatch.setattr('api.debt_workspace.today', lambda: datetime(2026, 11, 15).date())
    engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        owner = User(username='Owner', email='debt-owner@example.test', password_hash='unused')
        other = User(username='Other', email='debt-other@example.test', password_hash='unused')
        db.add_all([owner, other]); db.flush()
        space = Space(name='Home', owner_id=owner.id)
        db.add(space); db.flush()
        private = Wallet(name='Personal', user_id=owner.id)
        shared = Wallet(name='Home', user_id=owner.id, space_id=space.id)
        db.add_all([private, shared]); db.flush()
        day = datetime(2026, 11, 2, 10)
        a = Transaction(user_id=owner.id, wallet_id=private.id, amount=Decimal('10'), type='expense', date=day, description='Personal repayment')
        b = Transaction(user_id=owner.id, wallet_id=shared.id, amount=Decimal('10'), type='expense', date=day, description='Shared repayment')
        db.add_all([a, b]); db.commit()
        personal_id, shared_id = a.id, b.id
        actor = {'user': owner}
        monkeypatch.setitem(app.dependency_overrides, get_db, lambda: db)
        monkeypatch.setitem(app.dependency_overrides, current_user, lambda: actor['user'])
        client = TestClient(app)
        url = '/api/debt-workspace'
        assert client.get(url).json()['records'] == []
        options = client.get(url+'/linkable', params={'direction':'expense','day':'2026-11-02','amount':10000})
        assert options.status_code == 200, options.text
        assert options.json() == [{'id':personal_id,'description':'Personal repayment'}]

        payment = {'id':str(uuid4()),'amount':10000,'date':'2026-11-02','transaction_id':shared_id}
        item = {'id':str(uuid4()),'month':'2026-10','due':'2026-10-31','amount':40000,'payments':[payment]}
        record = {'id':str(uuid4()),'name':'Car loan','kind':'loan','opening':40000,'items':[item],'reminder':3}
        workspace = {'revision':0,'currency':'KWD','records':[record]}
        assert client.put(url,json=workspace).status_code == 422
        db.rollback()
        payment['transaction_id'] = personal_id
        saved = client.put(url,json=workspace)
        assert saved.status_code == 200, saved.text
        assert saved.json()['records'][0]['items'][0]['payments'][0]['date'] == '2026-11-02'
        assert saved.json()['records'][0]['items'][0]['month'] == '2026-10'
        assert client.put(url,json=workspace).status_code == 409
        db.rollback()
        duplicate = deepcopy(saved.json())
        duplicate_payment = {**payment, 'id':str(uuid4())}
        duplicate['records'][0]['items'][0]['payments'].append(duplicate_payment)
        assert client.put(url,json=duplicate).status_code == 422
        actor['user'] = other
        assert client.get(url).json()['records'] == []
        assert client.get(url+'/linkable', params={'direction':'expense','day':'2026-11-02','amount':10000}).json() == []
    engine.dispose()
