import json
from datetime import datetime, timedelta
from decimal import Decimal
from uuid import uuid4
from types import SimpleNamespace

import pytest
from fastapi.encoders import jsonable_encoder
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from api.app import app
from api.database import Base, get_db
from api.index import current_user, export_backup
from api.models import AppSetting, PlannedTransaction, Transaction, User, Wallet, WalletShare
from api.planner import KEY, archive_snapshot, forecast, occurrences
from api.ai_service import _local_answer, generate

AT = datetime(2026, 10, 5, 10)


@pytest.fixture
def workspace(monkeypatch):
    engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    monkeypatch.setattr('api.planner.now', lambda: AT)
    monkeypatch.setattr(app.state, 'storage_ready', True, raising=False)
    previous = app.dependency_overrides.copy()
    with Session(engine) as db:
        user = User(username='Planner', email='planner@test.example', password_hash='unused')
        other = User(username='Other', email='other@test.example', password_hash='unused')
        db.add_all([user,other]); db.flush()
        wallet = Wallet(user_id=user.id, name='Main', initial_balance=Decimal('100'))
        db.add(wallet); db.commit()
        actor = {'user': user}
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[current_user] = lambda: actor['user']
        with TestClient(app) as client:
            yield client, db, user, other, wallet, actor
        app.dependency_overrides = previous
    engine.dispose()


def bill(wallet, **changes):
    return {'id':str(uuid4()),'name':'Rent','amount':'20.000','wallet_id':wallet.id,
            'due_at':(AT+timedelta(days=2)).isoformat(),'frequency':'monthly',**changes}


def save(client, bills, revision=0, **changes):
    result = client.put('/api/planner/config', json={'revision':revision,'bills':bills,**changes})
    assert result.status_code == 200, result.text
    return result.json()


def tx(db, user, wallet, amount=10, kind='expense', when=None, **changes):
    row = Transaction(user_id=user.id,wallet_id=wallet.id,type=kind,amount=Decimal(str(amount)),date=when or AT-timedelta(days=1),description='Payment',reporting_month='2026-11',**changes)
    db.add(row); db.commit()
    return row


def plan(db,user,wallet,amount=20,status='planned',when=None,**changes):
    row = PlannedTransaction(owner_id=user.id,created_by_id=user.id,wallet_id=wallet.id,type='expense',amount=Decimal(str(amount)),description='Rent',due_at=when or AT+timedelta(days=2),status=status,**changes)
    db.add(row);db.commit()
    return row


def test_empty_forecast_is_read_only_and_has_all_horizons(workspace):
    client,db,user,_,wallet,_ = workspace
    for days in [30,60,90]:
        result=client.get(f'/api/planner/forecast?days={days}')
        assert result.status_code==200,result.text
        value=result.json()
        assert value['opening_balance']==value['available_to_spend']=='100.000'
        assert len(value['points'])==days+1
        assert not value['events']
    assert db.query(Transaction).count()==db.query(AppSetting).count()==0
    assert client.get('/api/planner/forecast?days=45').status_code==422


def test_cash_dates_not_reporting_month_and_future_income_not_spendable(workspace):
    client,db,user,_,wallet,_=workspace
    tx(db,user,wallet,10)
    tx(db,user,wallet,200,'income',AT+timedelta(days=10))
    tx(db,user,wallet,30,'expense',AT+timedelta(days=2))
    value=client.get('/api/planner/forecast').json()
    assert value['opening_balance']=='90.000'
    assert value['projected_balance']=='260.000'
    assert value['available_to_spend']=='60.000'
    assert value['next_payday'].startswith('2026-10-15')


def test_reserves_and_shortfall_are_exact(workspace):
    client,db,user,_,wallet,_=workspace
    save(client,[bill(wallet,amount='95.125')],goal_reserve='10.001',buffer='5.002')
    value=client.get('/api/planner/forecast').json()
    assert value['available_to_spend']=='-10.128'
    assert value['lowest_balance']=='4.875'
    assert value['shortfall_amount']=='10.128'
    assert value['shortfall_date']=='2026-10-07'
    assert db.query(Transaction).count()==0


def test_shared_archived_and_foreign_wallets_are_excluded(workspace):
    client,db,user,other,wallet,_=workspace
    shared=Wallet(user_id=user.id,name='Shared',initial_balance=1000)
    archived=Wallet(user_id=user.id,name='Archived',initial_balance=1000,archived=True)
    foreign=Wallet(user_id=other.id,name='Foreign',initial_balance=1000)
    db.add_all([shared,archived,foreign]);db.flush()
    db.add(WalletShare(wallet_id=shared.id,owner_id=user.id,invitee_email=other.email,member_user_id=other.id,permission='edit'));db.commit()
    assert client.get('/api/planner/forecast').json()['opening_balance']=='100.000'
    for w in [shared,archived,foreign]:
        assert client.put('/api/planner/config',json={'bills':[bill(w)]}).status_code==422
    assert client.get(f'/api/planner/payment-options?wallet_id={foreign.id}').status_code==403


def test_config_is_private_and_stale_revision_rejected(workspace):
    client,db,user,other,wallet,actor=workspace
    entry=bill(wallet)
    save(client,[entry])
    assert client.put('/api/planner/config',json={'revision':0,'bills':[]}).status_code==409
    assert len(client.get('/api/planner/config').json()['bills'])==1
    actor['user']=other
    assert client.get('/api/planner/config').json()['bills']==[]
    assert client.get('/api/planner/forecast').json()['opening_balance']=='0.000'


@pytest.mark.parametrize('amount',['-1','0','NaN','Infinity','1.0001','1000000000'])
def test_invalid_money_is_rejected(workspace,amount):
    client,_,_,_,wallet,_=workspace
    assert client.put('/api/planner/config',json={'bills':[bill(wallet,amount=amount)]}).status_code==422


def test_prices_are_server_tracked_and_not_editable(workspace):
    client,_,_,_,wallet,_=workspace
    entry=bill(wallet)
    save(client,[entry])
    entry['amount']='22.000'
    value=save(client,[entry],1)
    assert value['bills'][0]['price_history'][0]['amount']=='20.000'
    entry['price_history']=[]
    assert client.put('/api/planner/config',json={'revision':2,'bills':[entry]}).status_code==422


def test_month_end_and_leap_year_keep_original_anchor():
    rows=list(occurrences(datetime(2026,1,31,9),'monthly',datetime(2026,4,30,9)))
    assert [r.day for r in rows]==[31,28,31,30]
    rows=list(occurrences(datetime(2024,2,29,9),'yearly',datetime(2028,3,1)))
    assert [r.day for r in rows]==[29,28,28,28,29]


def test_assumptions_switch_and_overdue_plan_do_not_post(workspace):
    client,db,user,_,wallet,_=workspace
    save(client,[bill(wallet)])
    plan(db,user,wallet,10,'scheduled',AT-timedelta(days=1))
    plan(db,user,wallet,5,'planned')
    value=client.get('/api/planner/forecast?assumptions=false').json()
    assert value['projected_balance']=='90.000'
    assert value['warnings']
    assert len(value['events'])==1
    assert db.query(Transaction).count()==0
    assert db.query(PlannedTransaction).filter_by(status='scheduled').count()==1


def test_linked_upcoming_bill_is_counted_once(workspace):
    client,db,user,_,wallet,_=workspace
    p=plan(db,user,wallet)
    save(client,[bill(wallet,planned_id=p.id)])
    assert client.get('/api/planner/forecast').json()['projected_balance']=='80.000'
    p.status='failed';db.commit()
    assert client.get('/api/planner/forecast').json()['projected_balance']=='80.000'
    p.status='posted';payment=tx(db,user,wallet,20);p.posted_transaction_id=payment.id;db.commit()
    assert client.get('/api/planner/forecast').json()['projected_balance']=='80.000'


def test_invalid_link_and_duplicate_bill_ids_rejected(workspace):
    client,db,user,_,wallet,_=workspace
    p=plan(db,user,wallet,22)
    assert client.put('/api/planner/config',json={'bills':[bill(wallet,planned_id=p.id)]}).status_code==422
    entry=bill(wallet)
    assert client.put('/api/planner/config',json={'bills':[entry,entry]}).status_code==422


def test_payment_links_existing_ledger_without_duplicate_and_delete_reopens(workspace):
    client,db,user,other,wallet,_=workspace
    entry=bill(wallet)
    save(client,[entry])
    payment=tx(db,user,wallet,20)
    payload={'revision':1,'transaction_id':payment.id,'occurrence':entry['due_at']}
    result=client.post(f"/api/planner/bills/{entry['id']}/payment",json=payload)
    assert result.status_code==200,result.text
    assert db.query(Transaction).count()==1
    assert client.get('/api/planner/forecast').json()['projected_balance']=='80.000'
    payload['revision']=2
    assert client.post(f"/api/planner/bills/{entry['id']}/payment",json=payload).status_code==409
    db.delete(payment);db.commit()
    assert client.get('/api/planner/forecast').json()['projected_balance']=='80.000'
    assert len(client.get('/api/planner/forecast').json()['events'])==1
    replacement=tx(db,user,wallet,20)
    assert len(client.get('/api/planner/forecast').json()['events'])==1
    assert json.loads(export_backup(user,db)['settings'][KEY])['bills'][0]['payments']==[]
    payload['transaction_id']=replacement.id
    assert client.post(f"/api/planner/bills/{entry['id']}/payment",json=payload).status_code==200
    assert not client.get('/api/planner/forecast').json()['events']


def test_payment_cannot_link_foreign_expense(workspace):
    client,db,user,other,wallet,_=workspace
    entry=bill(wallet)
    save(client,[entry])
    expense=tx(db,other,wallet,20)
    result=client.post(f"/api/planner/bills/{entry['id']}/payment",json={'revision':1,'transaction_id':expense.id,'occurrence':entry['due_at']})
    assert result.status_code==422


def test_what_if_is_read_only_and_delta_is_exact(workspace):
    client,db,user,_,wallet,_=workspace
    baseline=client.get('/api/planner/forecast').json()
    result=client.post('/api/planner/preview?days=60',json={'amount':'12.345','date':'2026-10-10'})
    assert result.status_code==200,result.text
    assert result.json()['projected_balance']=='87.655'
    assert db.query(Transaction).count()==db.query(AppSetting).count()==0
    assert client.get('/api/planner/forecast').json()==baseline
    assert client.post('/api/planner/preview',json={'amount':'1','date':'2026-12-31'}).status_code==422


def test_internal_transfer_is_neutral_and_recurring_children_not_duplicated(workspace):
    client,db,user,_,wallet,_=workspace
    second=Wallet(user_id=user.id,name='Savings',initial_balance=0);db.add(second);db.commit()
    tx(db,user,wallet,30,'transfer',AT+timedelta(days=1),transfer_wallet_id=second.id)
    template=tx(db,user,wallet,10,'expense',AT-timedelta(days=7),recurring_frequency='weekly')
    tx(db,user,wallet,10,'expense',AT+timedelta(days=7),recurring_parent_id=template.id)
    value=client.get('/api/planner/forecast').json()
    assert not any(e['type']=='transfer' for e in value['events'])
    assert not any(e['id'].startswith('repeat:') and e['date'].startswith('2026-10-12') for e in value['events'])


def test_reminder_ids_stable_and_pause_removes_them(workspace):
    client,db,user,_,wallet,_=workspace
    entry=bill(wallet)
    save(client,[entry])
    first=client.get('/api/planner/reminders').json()['items']
    second=client.get('/api/planner/reminders').json()['items']
    assert first==second and len(first)==3
    assert all(400000000<=r['notification_id']<900000000 for r in first)
    entry['active']=False
    save(client,[entry],1)
    assert client.get('/api/planner/reminders').json()['items']==[]


def test_backup_restore_remaps_bill_wallet_plan_and_payments(workspace,monkeypatch):
    client,db,user,_,wallet,_=workspace
    p=plan(db,user,wallet)
    entry=bill(wallet,planned_id=p.id)
    save(client,[entry],goal_reserve='3.250')
    payment=tx(db,user,wallet,20)
    assert client.post(f"/api/planner/bills/{entry['id']}/payment",json={'revision':1,'transaction_id':payment.id,'occurrence':entry['due_at']}).status_code==200
    exported=export_backup(user,db)
    monkeypatch.setattr('api.account_security.confirmed',lambda *args:None)
    result=client.post('/api/backup/restore',json=jsonable_encoder(exported))
    assert result.status_code==200,result.text
    saved=client.get('/api/planner/config').json()
    assert saved['goal_reserve']=='3.250'
    restored=saved['bills'][0]
    assert db.get(Wallet,restored['wallet_id']).user_id==user.id
    assert db.get(PlannedTransaction,restored['planned_id']).owner_id==user.id
    assert db.get(Transaction,restored['payments'][0]['transaction_id']).user_id==user.id
    assert all(not e['id'].startswith(f"bill:{entry['id']}:2026-10-07") for e in client.get('/api/planner/forecast').json()['events'])


def test_invalid_planner_backup_rejected_before_records_change(workspace,monkeypatch):
    client,db,user,_,wallet,_=workspace
    exported=export_backup(user,db)
    exported['settings'][KEY]=json.dumps({'bills':[bill(wallet,wallet_id=99999)]})
    monkeypatch.setattr('api.account_security.confirmed',lambda *args:None)
    assert client.post('/api/backup/restore',json=jsonable_encoder(exported)).status_code==400
    assert db.get(Wallet,wallet.id) is not None


def test_builtin_explanation_uses_computed_values(workspace):
    client,db,user,_,wallet,_=workspace
    answer=_local_answer({'currency':'KWD','cash_flow_planner':forecast(db,user.id)},'Explain my cash-flow planner forecast')
    assert '100.000' in answer and 'no records were changed' in answer


def test_ai_forecast_respects_horizon_and_estimate_switch(workspace,monkeypatch):
    client,db,user,_,wallet,_=workspace
    save(client,[bill(wallet)])
    monkeypatch.setattr('api.ai_service.assistant_status',lambda db:{'available':False})
    chat=SimpleNamespace(scope='personal',wallet_id=None,month='2026-10')
    result=generate(db,user,chat,'Explain my 90-day cash-flow planner forecast. Exclude assumptions.',[])
    assert result['sources'][0]['key']=='planner:90'
    assert '100.000' in result['answer']
    assert '80.000' not in result['answer']
    assert db.query(Transaction).count()==0


def test_backup_prunes_deleted_references_without_losing_bill(workspace):
    client,db,user,_,wallet,_=workspace
    entry=bill(wallet)
    saved=save(client,[entry])
    saved['bills'][0]['payments']=[{'occurrence':entry['due_at'],'transaction_id':777}]
    snapshot=archive_snapshot(saved,set(),set(),set())
    assert snapshot['bills'][0]['name']=='Rent'
    assert snapshot['bills'][0]['wallet_id']==0
    assert snapshot['bills'][0]['active'] is False
    assert snapshot['bills'][0]['payments']==[]


def test_backup_preserves_recurring_parent_links(workspace,monkeypatch):
    client,db,user,_,wallet,_=workspace
    parent=tx(db,user,wallet,10,'expense',AT-timedelta(days=14),recurring_frequency='weekly')
    child=tx(db,user,wallet,10,'expense',AT-timedelta(days=7),recurring_parent_id=parent.id)
    exported=export_backup(user,db)
    monkeypatch.setattr('api.account_security.confirmed',lambda *args:None)
    assert client.post('/api/backup/restore',json=jsonable_encoder(exported)).status_code==200
    recurring=db.query(Transaction).filter(Transaction.recurring_frequency!='none').one()
    restored_child=db.query(Transaction).filter(Transaction.recurring_parent_id==recurring.id).one()
    assert restored_child.date==child.date


def test_planner_requires_authentication(workspace):
    client,_,_,_,_,_=workspace
    del app.dependency_overrides[current_user]
    assert client.get('/api/planner/config').status_code==401
    assert client.get('/api/planner/forecast').status_code==401
