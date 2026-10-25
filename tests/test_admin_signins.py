from datetime import timedelta
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from api import account_security as security
from api.database import Base, get_db
from api.index import current_user, admin_users
from api.models import User, utc_now
from api.reliability_models import AccountSession


@pytest.fixture
def workspace():
    engine = create_engine('sqlite://', connect_args={'check_same_thread':False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        admin = User(username='Admin',email='admin@example.test',password_hash='private',role='admin')
        target = User(username='User',email='user@example.test',password_hash='private',role='user')
        db.add_all([admin,target]); db.commit()
        app = FastAPI(); app.include_router(security.router)
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[current_user] = lambda: admin
        with TestClient(app) as client:
            yield client, db, admin, target, app
    engine.dispose()


def test_history_is_admin_only_bounded_private_and_does_not_mutate_sessions(workspace):
    client,db,admin,target,app = workspace
    now = utc_now()
    for index in range(52):
        db.add(AccountSession(id=f'private-session-{index}', user_id=target.id,
            label='Mozilla Android Chrome/123 private-raw-useragent', created_at=now-timedelta(days=index),last_seen=now,
            revoked=index==0))
    db.add(AccountSession(id='other-private-session',user_id=admin.id))
    db.commit()
    response = client.get(f'/api/admin/users/{target.id}/signins')
    assert response.status_code == 200 and response.headers['cache-control']=='no-store'
    data = response.json()
    assert len(data['items'])==50 and data['has_more']
    assert data['items'][0]['status']=='Ended'
    assert data['items'][1]['status']=='Expired'
    assert data['items'][0]['device']=='Android · Chrome'
    assert data['items'][1]['signed_in_at'] != data['items'][1]['last_active_at']
    for secret in ('private-session','other-private','private-raw','verified_at','password'):
        assert secret not in response.text
    assert len(client.get(f'/api/admin/users/{target.id}/signins?offset=50').json()['items'])==2
    assert client.get(f'/api/admin/users/{target.id}/signins?offset=-1').status_code==422
    assert client.get('/api/admin/users/999999/signins').status_code==404
    assert db.query(AccountSession).count()==53
    directory = admin_users(admin, db)
    assert next(row for row in directory if row['id']==target.id)['last_signed_in_at']==now.isoformat()+'Z'
    app.dependency_overrides[current_user] = lambda: target
    assert client.get(f'/api/admin/users/{target.id}/signins').status_code==403
    assert client.get(f'/api/admin/users/{admin.id}/signins').status_code==403


def test_empty_history_and_unknown_device(workspace):
    client,db,admin,target,app = workspace
    assert client.get(f'/api/admin/users/{target.id}/signins').json()=={'items':[],'has_more':False}
    assert security.session_device('Browser session')=='Device not recorded'
