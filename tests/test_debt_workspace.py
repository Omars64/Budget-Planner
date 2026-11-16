from copy import deepcopy
from datetime import datetime
from decimal import Decimal
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from api.app import app
from api.auth_dependency import current_user
from api.database import Base, get_db
from api.debt_workspace import DebtSpaceArchive, export_debt_spaces, restore_debt_spaces
from api.models import DebtSpaceAlert, DebtSpaceMember, Space, Transaction, User, Wallet


def test_debt_space_rename_and_delete_are_owner_only_and_scoped(monkeypatch):
    monkeypatch.setattr('api.debt_workspace.today', lambda: datetime(2026, 11, 15).date())
    engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)

    @event.listens_for(engine, 'connect')
    def enforce_foreign_keys(connection, _):
        connection.execute('PRAGMA foreign_keys=ON')

    Base.metadata.create_all(engine)
    with Session(engine) as db, TestClient(app) as client:
        owner, manager, viewer, stranger = [
            User(username=name, email=f'{name.lower()}@example.test', password_hash='unused')
            for name in ('Owner', 'Manager', 'Viewer', 'Stranger')
        ]
        db.add_all([owner, manager, viewer, stranger])
        db.commit()
        actor = {'user': owner}
        monkeypatch.setitem(app.dependency_overrides, get_db, lambda: db)
        monkeypatch.setitem(app.dependency_overrides, current_user, lambda: actor['user'])
        root = '/api/debt-workspace'
        spaces = root + '/spaces'
        target = client.post(spaces, json={'name':'Family debts','currency':'KWD'}).json()
        other = client.post(spaces, json={'name':'Trip repayments','currency':'USD'}).json()
        path = spaces + '/' + target['id']
        other_path = spaces + '/' + other['id']
        item = {'id':str(uuid4()),'month':'2026-11','due':'2026-11-20','amount':40000,
                'payments':[{'id':str(uuid4()),'amount':10000,'date':'2026-11-14'}]}
        record = {'id':str(uuid4()),'name':'Car loan','kind':'loan','opening':40000,'items':[item],'reminder':3}
        ledger = {'revision':0,'currency':'KWD','records':[record]}
        assert client.put(root,json=ledger).status_code == 200
        saved = client.put(path,json=ledger)
        assert saved.status_code == 200
        assert client.put(other_path,json={**ledger,'currency':'USD'}).status_code == 200
        for person, role in ((manager,'edit'),(viewer,'view')):
            assert client.put(path+'/members',json={'email':person.email,'role':role}).status_code == 200
            actor['user'] = person
            rows = client.get(spaces).json()
            assert rows[0]['id'] == target['id']
            assert rows[0]['role'] == role
            assert rows[0]['currency'] == 'KWD'
            assert rows[0]['owner_name'] == 'Owner'
            assert client.patch(path,json={'name':'Renamed'}).status_code == 403
            db.rollback()
            assert client.request('DELETE',path,json={'confirmation_name':'Family debts'}).status_code == 403
            db.rollback()
            assert client.put(path+'/alerts',json={'enabled':True,'rules':{record['id']:3}}).status_code == 200
            assert len(client.get(root+'/reminders').json()) == 1
            actor['user'] = owner

        actor['user'] = stranger
        assert client.request('DELETE',path,json={'confirmation_name':'Family debts'}).status_code == 404
        db.rollback()
        actor['user'] = owner
        assert client.put(other_path+'/alerts',json={'enabled':True,'rules':{record['id']:3}}).status_code == 200
        assert client.put(other_path+'/members',json={'email':viewer.email,'role':'view'}).status_code == 200
        renamed = client.patch(path,json={'name':'Family repayments'})
        assert renamed.status_code == 200
        assert renamed.json()['name'] == 'Family repayments'
        assert renamed.json()['member_count'] == 3
        assert client.get(path).json() == saved.json()
        assert client.patch(path,json={'name':'Family repayments','currency':'USD'}).status_code == 422
        for name in ('Family debts', ' Family repayments '):
            assert client.request('DELETE',path,json={'confirmation_name':name}).status_code == 409
            db.rollback()
        assert client.request('DELETE',path,json={'confirmation_name':'Family repayments'}).status_code == 204
        assert [row['id'] for row in client.get(spaces).json()] == [other['id']]
        assert client.get(root).json()['records'] == saved.json()['records']
        assert client.get(other_path).json()['records'] == saved.json()['records']
        assert db.query(DebtSpaceMember.space_id).all() == [(other['id'],)]
        assert db.query(DebtSpaceAlert.space_id).all() == [(other['id'],)]
        actor['user'] = manager
        assert client.get(path).status_code == 404
        assert client.get(path+'/access').status_code == 404
        assert client.get(root+'/reminders').json() == []
    engine.dispose()


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


def test_shared_permissions_reminders_and_extra_payment_are_scoped(monkeypatch):
    monkeypatch.setattr('api.debt_workspace.today', lambda: datetime(2026, 11, 15).date())
    engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine) as db, TestClient(app) as client:
        owner, member, stranger = [
            User(username=name, email=f'{name.lower()}@example.test', password_hash='unused')
            for name in ('Owner', 'Member', 'Stranger')
        ]
        db.add_all([owner, member, stranger])
        db.commit()
        actor = {'user': owner}
        monkeypatch.setitem(app.dependency_overrides, get_db, lambda: db)
        monkeypatch.setitem(app.dependency_overrides, current_user, lambda: actor['user'])
        root = '/api/debt-workspace'
        spaces = root + '/spaces'
        creation = client.post(spaces, json={'name':'Family debts','currency':'KWD'})
        assert creation.status_code == 201, creation.text
        space = creation.json()
        url = spaces + '/' + space['id']
        items = [{'id':str(uuid4()),'month':month,'due':month+'-01','amount':12000}
                 for month in ('2026-12','2027-01','2027-02')]
        record = {'id':str(uuid4()),'name':'Car loan','kind':'loan','opening':36000,'items':items,'apr':0}
        workspace = {'revision':0,'currency':'KWD','records':[record]}
        assert client.put(url,json=workspace).status_code == 200
        assert client.put(url+'/members',json={'email':member.email,'role':'view'}).status_code == 200
        db.rollback()
        actor['user'] = member
        assert client.get(spaces).json()[0]['role'] == 'view'
        assert client.get(url).json()['records'][0]['name'] == 'Car loan'
        assert client.get(root).json()['records'] == []
        payload = {'revision':1,'record_id':record['id'],'item_id':items[0]['id'],
                   'payment':{'id':str(uuid4()),'amount':15000,'date':'2026-11-15'}}
        assert client.post(url+'/payments',json=payload).status_code == 403
        db.rollback()
        assert client.put(url+'/members',json={'email':stranger.email,'role':'edit'}).status_code == 403
        db.rollback()
        assert client.put(url+'/alerts',json={'enabled':True,'rules':{record['id']:3}}).status_code == 200
        assert len(client.get(root+'/reminders').json()) == 3
        actor['user'] = owner
        assert client.get(root+'/reminders').json() == []
        assert client.put(url+'/members',json={'email':member.email,'role':'edit'}).status_code == 200
        original_email = member.email
        assert client.put(url+'/members',json={'email':'renamed@example.test','role':'view'}).status_code == 200
        member.email = 'renamed@example.test'
        db.commit()
        actor['user'] = member
        assert client.get(spaces).json()[0]['role'] == 'edit'
        assert client.get(url+'/access').json()['member_count'] == 2
        invalid = deepcopy(payload)
        invalid['payment']['amount'] = 36001
        assert client.post(url+'/payments',json=invalid).status_code == 422
        db.rollback()
        response = client.post(url+'/payments',json=payload)
        assert response.status_code == 200, response.text
        saved = response.json()
        assert [entry['amount'] for entry in saved['records'][0]['items']] == [15000,10500,10500]
        assert saved['records'][0]['items'][0]['payments'][0]['amount'] == 15000
        assert client.post(url+'/payments',json=payload).json() == saved
        db.rollback()
        settlement = {**payload,'revision':2,'item_id':items[1]['id'],
                      'payment':{'id':str(uuid4()),'amount':21000,'date':'2026-11-15'}}
        result = client.post(url+'/payments',json=settlement)
        assert result.status_code == 200, result.text
        covered = result.json()['records'][0]['items'][-1]
        assert (covered['amount'],covered['payments'],covered['covered_by']) == (0,[],'2027-01')
        assert client.get(root+'/reminders').json() == []
        actor['user'] = stranger
        assert client.get(url).status_code == 404
        assert export_debt_spaces(db, member.id) == []
        archive = DebtSpaceArchive.model_validate(export_debt_spaces(db, owner.id)[0])
        restore_debt_spaces(db, stranger.id, [archive])
        db.commit()
        clone = client.get(spaces).json()[0]
        assert clone['id'] != space['id'] and clone['member_count'] == 1
        assert client.get(url).status_code == 404
        assert client.get(spaces+'/'+clone['id']).json()['records'][0]['items'][-1]['covered_by'] == '2027-01'
        actor['user'] = owner
        assert client.delete(url+'/members/'+original_email).status_code == 200
        actor['user'] = member
        assert client.get(spaces).json() == []
        assert client.get(url).status_code == 404
    engine.dispose()
