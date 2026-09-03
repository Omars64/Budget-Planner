import os
import tempfile
from pathlib import Path

TEST_DB = Path(tempfile.gettempdir()) / 'flowbudget_pytest.db'
if TEST_DB.exists(): TEST_DB.unlink()
os.environ['DATABASE_URL'] = f'sqlite:///{TEST_DB}'
os.environ['APP_SECRET'] = 'test-secret'
os.environ['ADMIN_INITIAL_PASSWORD'] = 'FlowBudgetAdmin!ChangeMe2026'

from fastapi.testclient import TestClient
from api.index import app


def auth_headers(client, email='omarsolanki46@gmail.com', password='FlowBudgetAdmin!ChangeMe2026'):
    r = client.post('/api/auth/login', json={'email': email, 'password': password})
    assert r.status_code == 200, r.text
    return {'Authorization': f"Bearer {r.json()['token']}"}


def test_auth_admin_user_management_and_isolation():
    with TestClient(app) as client:
        assert client.get('/api/wallets').status_code == 401
        admin = auth_headers(client)
        me = client.get('/api/auth/me', headers=admin).json()
        assert me['role'] == 'admin'

        user_payload = {'username': 'Sara', 'email': 'sara@example.com', 'password': 'StrongPass123', 'role': 'user', 'active': True}
        r = client.post('/api/admin/users', json=user_payload, headers=admin)
        assert r.status_code == 201, r.text
        user_id = r.json()['id']
        users = client.get('/api/admin/users', headers=admin).json()
        assert any(u['email'] == 'sara@example.com' for u in users)

        user_headers = auth_headers(client, 'sara@example.com', 'StrongPass123')
        assert client.get('/api/admin/users', headers=user_headers).status_code == 403
        admin_wallets = client.get('/api/wallets', headers=admin).json()
        user_wallets = client.get('/api/wallets', headers=user_headers).json()
        assert admin_wallets[0]['id'] != user_wallets[0]['id']

        update = {'username': 'Sara S', 'email': 'sara@example.com', 'role': 'user', 'active': True, 'password': 'NewStrongPass123'}
        assert client.put(f'/api/admin/users/{user_id}', json=update, headers=admin).status_code == 200
        assert client.post('/api/auth/login', json={'email': 'sara@example.com', 'password': 'StrongPass123'}).status_code == 401
        assert auth_headers(client, 'sara@example.com', 'NewStrongPass123')

        assert client.delete(f'/api/admin/users/{user_id}', headers=admin).status_code == 204
        assert client.post('/api/auth/login', json={'email': 'sara@example.com', 'password': 'NewStrongPass123'}).status_code == 401


def test_core_financial_flows():
    with TestClient(app) as client:
        headers = auth_headers(client)
        assert client.get('/api/health').status_code == 200
        wallets = client.get('/api/wallets', headers=headers).json()
        assert len(wallets) >= 3
        source, dest = wallets[0], wallets[1]
        before_source, before_dest = source['balance'], dest['balance']

        expense_cat = next(c for c in client.get('/api/categories?kind=expense', headers=headers).json())
        tx = {
            'type': 'expense', 'amount': 12.5, 'description': 'Regression lunch', 'notes': '',
            'date': '2026-09-03T12:00:00', 'wallet_id': source['id'], 'transfer_wallet_id': None,
            'category_id': expense_cat['id'], 'recurring_frequency': 'none', 'recurring_until': None,
        }
        r = client.post('/api/transactions', json=tx, headers=headers)
        assert r.status_code == 201, r.text
        tx_id = r.json()['id']
        after_expense = next(w for w in client.get('/api/wallets', headers=headers).json() if w['id'] == source['id'])
        assert round(before_source - after_expense['balance'], 3) == 12.5

        transfer = {**tx, 'type': 'transfer', 'amount': 40, 'description': 'Regression transfer', 'category_id': None, 'transfer_wallet_id': dest['id']}
        r = client.post('/api/transactions', json=transfer, headers=headers)
        assert r.status_code == 201
        post_wallets = client.get('/api/wallets', headers=headers).json()
        new_source = next(w for w in post_wallets if w['id'] == source['id'])
        new_dest = next(w for w in post_wallets if w['id'] == dest['id'])
        assert round(after_expense['balance'] - new_source['balance'], 3) == 40
        assert round(new_dest['balance'] - before_dest, 3) == 40

        assert client.delete(f'/api/transactions/{tx_id}', headers=headers).status_code == 204

        from datetime import datetime, timedelta
        recurring_date = datetime.now() - timedelta(days=2)
        recurring = {**tx, 'description': 'Regression recurring', 'date': recurring_date.isoformat(), 'amount': 3.125, 'recurring_frequency': 'daily', 'recurring_until': (datetime.now() - timedelta(days=1)).date().isoformat()}
        assert client.post('/api/transactions', json=recurring, headers=headers).status_code == 201
        recurring_rows = client.get('/api/transactions?search=Regression%20recurring', headers=headers).json()
        assert len(recurring_rows) >= 2


def test_budget_goal_debt_backup_and_restore():
    with TestClient(app) as client:
        headers = auth_headers(client)
        cats = client.get('/api/categories?kind=expense', headers=headers).json()
        budget = {'name':'Regression budget','category_id':cats[0]['id'],'limit_amount':100,'period':'monthly','start_date':'2026-09-01','notify_threshold':80}
        assert client.post('/api/budgets', json=budget, headers=headers).status_code == 201
        assert any(b['name']=='Regression budget' for b in client.get('/api/budgets', headers=headers).json())

        goal = {'name':'Regression goal','target_amount':500,'current_amount':50,'deadline':'2026-12-01','icon':'target','color':'#0a4173'}
        gid = client.post('/api/goals', json=goal, headers=headers).json()['id']
        assert client.post(f'/api/goals/{gid}/contribute', json={'amount':25}, headers=headers).json()['current_amount'] == 75

        debt = {'name':'Regression debt','kind':'owed','principal':200,'remaining':200,'interest_rate':0,'due_date':'2026-12-01','minimum_payment':20,'notes':''}
        did = client.post('/api/debts', json=debt, headers=headers).json()['id']
        assert client.post(f'/api/debts/{did}/pay', json={'amount':30}, headers=headers).json()['remaining'] == 170

        backup = client.get('/api/backup', headers=headers)
        assert backup.status_code == 200
        assert backup.json()['version'] == 1
        restore = client.post('/api/backup/restore', json=backup.json(), headers=headers)
        assert restore.status_code == 200, restore.text
        assert client.get('/api/dashboard', headers=headers).status_code == 200
        assert client.get('/api/calendar?year=2026&month=9', headers=headers).status_code == 200


def test_validation_guards_and_boundaries():
    with TestClient(app) as client:
        headers = auth_headers(client)
        wallets = client.get('/api/wallets', headers=headers).json()
        bad_transfer = {
            'type':'transfer','amount':10,'description':'bad','notes':'','date':'2026-09-03T12:00:00',
            'wallet_id':wallets[0]['id'],'transfer_wallet_id':wallets[0]['id'],'category_id':None,
            'recurring_frequency':'none','recurring_until':None,
        }
        assert client.post('/api/transactions', json=bad_transfer, headers=headers).status_code == 422

        expense_cat = client.get('/api/categories?kind=expense', headers=headers).json()[0]
        income_cat = client.get('/api/categories?kind=income', headers=headers).json()[0]
        wrong_category = {**bad_transfer, 'type':'expense', 'transfer_wallet_id':None, 'category_id':income_cat['id'], 'description':'wrong category'}
        assert client.post('/api/transactions', json=wrong_category, headers=headers).status_code == 400

        before = wallets[0]['balance']
        cat_resp = client.post('/api/categories', json={'name':'Boundary regression','kind':'expense','icon':'circle','color':'#0a4173'}, headers=headers)
        category_id = cat_resp.json()['id']
        for i in range(3):
            r = client.post('/api/transactions', json={
                'type':'expense','amount':'0.001','description':f'Precision {i}','notes':'',
                'date':'2026-09-03T09:00:00','wallet_id':wallets[0]['id'],'transfer_wallet_id':None,
                'category_id':category_id,'recurring_frequency':'none','recurring_until':None,
            }, headers=headers)
            assert r.status_code == 201, r.text
        after = next(w for w in client.get('/api/wallets', headers=headers).json() if w['id'] == wallets[0]['id'])
        assert round(before - after['balance'], 3) == 0.003

        assert client.delete(f"/api/wallets/{wallets[0]['id']}", headers=headers).status_code == 409
        feb = client.get('/api/dashboard?month=2026-02', headers=headers).json()
        assert len(feb['cashflow']) == 28
