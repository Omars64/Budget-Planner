from fastapi.testclient import TestClient
from tests.test_api import auth_headers
from api.app import app


def test_forwarding_is_scoped_revocable_and_records_once():
    with TestClient(app) as client:
        admin = auth_headers(client)
        user = client.post('/api/admin/users', headers=admin, json={'username':'Forwarding test','email':'forward-test@example.com','password':'StrongPass123!'}).json()
        headers = auth_headers(client, user['email'], 'StrongPass123!')
        assert client.post('/api/bank-messages/key', headers=headers).status_code == 410
        assert client.get('/api/bank-messages/key', headers=headers).json() == {'enabled': False}
        body = {'bank':'NBK','reference':'device-1','message':'Purchase KWD 1.000 at shop'}
        assert client.post('/api/bank-messages/forward', json=body).status_code == 410
        forwarded = client.post('/api/bank-messages', headers=headers, json=body)
        assert forwarded.status_code == 201
        mid = forwarded.json()['id']
        assert client.post('/api/bank-messages', headers=headers, json=body).json()['id'] == mid
        assert len(client.get('/api/bank-messages', headers=headers).json()) == 1
        assert not any(m['id'] == mid for m in client.get('/api/bank-messages', headers=admin).json())
        wallet = client.get('/api/wallets', headers=headers).json()[0]
        tx = {'type':'expense','amount':1,'description':'Imported purchase','date':'2026-09-07T12:00:00','wallet_id':wallet['id']}
        path = f'/api/bank-messages/{mid}/record'
        assert client.post(path, headers=admin, json=tx).status_code == 404
        assert client.post(path, headers=headers, json=tx).status_code == 200
        assert client.post(path, headers=headers, json=tx).status_code == 409
        assert client.get('/api/bank-messages', headers=headers).json() == []
        assert client.post('/api/bank-messages', headers=headers, json={**body,'reference':'otp','message':'Your OTP is 123456'}).status_code == 422
        assert client.delete('/api/bank-messages/key', headers=headers).status_code == 204
        assert client.post('/api/bank-messages/forward', headers={'X-FlowBudget-Key':'old-key'}, json={**body,'reference':'device-2'}).status_code == 410
        assert client.delete(f"/api/admin/users/{user['id']}", headers=admin).status_code == 204
