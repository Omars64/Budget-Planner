from datetime import date
import pytest
from fastapi.testclient import TestClient
from api.app import app
from api.database import SessionLocal
from api.models import Transaction
from api.reliability_models import RateBucket
from tests.test_api import auth_headers


@pytest.fixture(autouse=True)
def isolate_rate_buckets():
    # Keep this module's repeated sign-ins from consuming other tests' limits.
    with SessionLocal() as db:
        db.query(RateBucket).delete()
        db.commit()
    yield
    with SessionLocal() as db:
        db.query(RateBucket).delete()
        db.commit()


def test_recovery_and_trash_deletion_are_account_scoped():
    with TestClient(app) as client:
        admin = auth_headers(client)
        people = []
        for name in ('v2-owner', 'v2-stranger'):
            person = client.post('/api/admin/users', headers=admin, json={'username':name,'email':name+'@example.com','password':'StrongPass123!'}).json()
            people.append((person, auth_headers(client, person['email'], 'StrongPass123!')))
        owner, stranger = people[0][1], people[1][1]
        wallet = client.get('/api/wallets', headers=owner).json()[0]
        payload = {'type':'expense','amount':1,'description':'Delete check','date':'2026-09-12T12:00:00','wallet_id':wallet['id']}
        tx = client.post('/api/transactions', headers=owner, json=payload).json()
        assert client.delete(f"/api/transactions/{tx['id']}",headers=owner).status_code == 204
        item = client.get('/api/trash',headers=owner).json()[0]
        # A workspace clear creates a recovery snapshot but preserves categories/Main Wallet.
        cleared = client.post('/api/workspace/clear',headers=owner,json={'confirmation':'CLEAR','scope':'budget'})
        assert cleared.status_code == 200, cleared.text
        point = cleared.json()['recovery_id']
        for path in (f"/api/trash/{item['id']}", f'/api/recovery/{point}'):
            assert client.delete(path).status_code == 401
            assert client.delete(path,headers=stranger).status_code == 404
            assert client.delete(path,headers=owner).status_code == 204
            assert client.delete(path,headers=owner).status_code == 404
        assert client.post(f"/api/trash/{item['id']}/restore",headers=owner).status_code == 404
        assert client.get(f'/api/recovery/{point}',headers=owner).status_code == 404
        assert client.get('/api/wallets',headers=owner).json()[0]['name'] == 'Main Wallet'
        assert client.get('/api/categories',headers=owner).json()
        for person, _ in people:
            client.delete(f"/api/admin/users/{person['id']}",headers=admin)


@pytest.mark.parametrize('frequency,until', [('daily','2020-01-03'),('weekly','2020-01-15'),('monthly','2020-03-01'),('yearly','2022-01-01')])
def test_recurring_writes_require_end_date_and_stop_inclusively(frequency, until):
    with TestClient(app) as client:
        headers = auth_headers(client)
        wallet = client.get('/api/wallets',headers=headers).json()[0]
        payload = {'type':'expense','amount':1,'description':'V2 bounded '+frequency,'date':'2020-01-01T12:00:00','wallet_id':wallet['id'],'recurring_frequency':frequency}
        assert client.post('/api/transactions',headers=headers,json=payload).status_code == 422
        assert client.post('/api/transactions',headers=headers,json={**payload,'recurring_until':'2019-12-31'}).status_code == 422
        created = client.post('/api/transactions',headers=headers,json={**payload,'recurring_until':until})
        assert created.status_code == 201, created.text
        tx = created.json()
        client.get('/api/transactions',headers=headers)
        client.get('/api/transactions',headers=headers)
        with SessionLocal() as db:
            occurrences=db.query(Transaction).filter_by(recurring_parent_id=tx['id']).all()
            assert len(occurrences)==2
            assert max(t.date.date() for t in occurrences)==date.fromisoformat(until)
        assert client.put(f"/api/transactions/{tx['id']}",headers={**headers,'If-Match':tx['revision']},json=payload).status_code == 422
        client.delete(f"/api/transactions/{tx['id']}",headers=headers)
