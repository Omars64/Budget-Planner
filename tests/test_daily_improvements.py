import base64
import io
from datetime import datetime
from decimal import Decimal
import pytest
from PIL import Image
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from api.app import app
from api.database import Base, get_db
from api.index import current_user, export_backup
from api.models import Transaction, TransactionReceipt, User, Wallet
from api.recovery import trash

@pytest.fixture
def workspace(monkeypatch):
    engine=create_engine('sqlite://',connect_args={'check_same_thread':False},poolclass=StaticPool)
    @event.listens_for(engine,'connect')
    def foreign_keys(connection,_):
        connection.execute('PRAGMA foreign_keys=ON')
    Base.metadata.create_all(engine)
    previous=app.dependency_overrides.copy()
    monkeypatch.setattr(app.state,'storage_ready',True,raising=False)
    monkeypatch.setattr('api.account_security.confirmed',lambda *args:None)
    with Session(engine) as db:
        user=User(username='Owner',email='owner@daily.test',password_hash='unused')
        other=User(username='Other',email='other@daily.test',password_hash='unused')
        db.add_all([user,other]);db.flush()
        wallet=Wallet(user_id=user.id,name='Main',initial_balance=0)
        db.add(wallet);db.flush()
        tx=Transaction(user_id=user.id,wallet_id=wallet.id,type='expense',amount=Decimal('10'),description='Coffee',date=datetime(2026,10,5,12),reporting_month='2026-10')
        db.add(tx);db.commit()
        actor={'user':user}
        app.dependency_overrides[get_db]=lambda:db
        app.dependency_overrides[current_user]=lambda:actor['user']
        yield TestClient(app),db,user,other,wallet,tx,actor
        app.dependency_overrides=previous
    engine.dispose()

def photo():
    stream=io.BytesIO()
    Image.new('RGB',(4,4),'white').save(stream,format='JPEG')
    return {'name':'receipt.jpg','image':'data:image/jpeg;base64,'+base64.b64encode(stream.getvalue()).decode()}

def test_receipts_private_validated_backed_up_and_restored(workspace):
    client,db,user,other,wallet,tx,actor=workspace
    path=f'/api/transactions/{tx.id}/receipt'
    assert client.put(path,json=photo()).status_code==200
    assert client.put(path,json={'name':'bad','image':'data:image/svg+xml;base64,AAAA'}).status_code==422
    actor['user']=other
    assert client.get(path).status_code==404
    assert client.delete(path).status_code==404
    actor['user']=user
    backup=export_backup(user,db)
    assert len(backup['receipts'])==1
    from fastapi.encoders import jsonable_encoder
    response=client.post('/api/backup/restore',json=jsonable_encoder(backup))
    assert response.status_code==200,response.text
    receipt=db.query(TransactionReceipt).one()
    assert receipt.name=='receipt.jpg'
    assert db.get(Transaction,receipt.transaction_id).user_id==user.id

def test_receipt_survives_transaction_trash_restore(workspace):
    client,db,user,other,wallet,tx,actor=workspace
    client.put(f'/api/transactions/{tx.id}/receipt',json=photo())
    point=trash(db,tx,user,'transaction')
    point_id=point.id
    db.delete(tx);db.commit()
    assert db.query(TransactionReceipt).count()==0
    response=client.post(f'/api/trash/{point_id}/restore')
    assert response.status_code==200,response.text
    assert db.query(TransactionReceipt).one().name=='receipt.jpg'

def test_bank_matches_are_explicit_and_do_not_change_existing_records(workspace):
    client,db,user,other,wallet,tx,actor=workspace
    data={'text':'date,description,amount,type\n2026-10-06,BANK COFFEE,10,expense','wallet_id':wallet.id}
    row=client.post('/api/statements/preview',json=data).json()[0]
    assert not row['duplicate']
    assert row['candidates'][0]['id']==tx.id
    result=client.post('/api/statements/import',json={'transactions':[{**row['transaction'],'matched_transaction_id':tx.id}]})
    assert result.status_code==200,result.text
    assert result.json()['matched']==1
    assert db.query(Transaction).count()==1
    assert db.get(Transaction,tx.id).description=='Coffee'
    altered={**row['transaction'],'amount':20,'matched_transaction_id':tx.id}
    assert client.post('/api/statements/import',json={'transactions':[altered]}).status_code==409

def test_preview_flags_duplicates_within_the_same_csv(workspace):
    client,db,user,other,wallet,tx,actor=workspace
    rows=client.post('/api/statements/preview',json={'wallet_id':wallet.id,'text':'date,description,amount,type\n2026-10-06,New,5,expense\n2026-10-06,New,5.000,expense'}).json()
    assert not rows[0]['duplicate']
    assert rows[1]['duplicate']
