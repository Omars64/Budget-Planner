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


def test_passwords_are_stored_as_one_way_hashes():
    from api.index import hash_password, verify_password

    raw = 'StrongPass123!'
    stored = hash_password(raw)
    assert stored.startswith('scrypt$')
    assert raw not in stored
    assert verify_password(raw, stored)
    assert not verify_password('wrong-password', stored)


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
        user_categories = client.get(f'/api/admin/users/{user_id}/categories', headers=admin)
        assert user_categories.status_code == 200 and any(c['name'] == 'Food & Dining' for c in user_categories.json())
        added_category = client.post(f'/api/admin/users/{user_id}/categories', headers=admin, json={'name': 'Admin managed', 'kind': 'expense'}).json()
        assert client.put(f"/api/admin/users/{user_id}/categories/{added_category['id']}", headers=admin, json={'name': 'Admin managed updated', 'kind': 'expense', 'icon': 'tag', 'color': '#123456'}).status_code == 200
        assert client.delete(f"/api/admin/users/{user_id}/categories/{added_category['id']}", headers=admin).status_code == 204

        admin_categories = client.get(f"/api/admin/users/{me['id']}/categories", headers=admin).json()
        missing = next(category for category in admin_categories if category['name'] == 'Other Income')
        assert client.delete(f"/api/admin/users/{me['id']}/categories/{missing['id']}", headers=admin).status_code == 204
        from api.database import SessionLocal
        from api.models import AppSetting
        from api.seed import seed_database
        with SessionLocal() as db:
            marker = db.get(AppSetting, {"user_id": me['id'], "key": "default_categories_restored"})
            if marker:
                db.delete(marker)
            db.commit()
            seed_database(db, include_demo=False)
        assert any(category['name'] == 'Other Income' for category in client.get(f"/api/admin/users/{me['id']}/categories", headers=admin).json())

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


def test_transaction_retry_and_preferences():
    with TestClient(app) as client:
        headers = auth_headers(client)
        wallet = client.get('/api/wallets', headers=headers).json()[0]
        body = {'type': 'expense', 'amount': 1, 'description': 'Idempotency regression', 'date': '2026-09-07T12:00:00', 'wallet_id': wallet['id']}
        keyed = {**headers, 'Idempotency-Key': 'retry-regression'}
        first = client.post('/api/transactions', headers=keyed, json=body)
        second = client.post('/api/transactions', headers=keyed, json=body)
        assert first.status_code == second.status_code == 201
        assert first.json()['id'] == second.json()['id']
        assert client.post('/api/transactions', headers=keyed, json={**body, 'amount': 2}).status_code == 409
        assert len(client.get('/api/transactions?search=Idempotency%20regression', headers=headers).json()) == 1
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda _: client.post('/api/transactions', headers={**headers, 'Idempotency-Key':'concurrent-retry'}, json={**body,'description':'Concurrent receipt'}), range(4)))
        assert all(result.status_code == 201 for result in results)
        assert len({result.json()['id'] for result in results}) == 1
        settings = client.get('/api/settings', headers=headers).json()
        updated = {**settings, 'phone': '+96512345678', 'font_family': 'georgia', 'text_color': 'charcoal', 'reminders_enabled': True}
        assert client.put('/api/settings', headers=headers, json=updated).status_code == 200
        assert client.get('/api/settings', headers=headers).json()['phone'] == updated['phone']
        assert client.put('/api/settings', headers=headers, json={**updated, 'phone': '123'}).status_code == 422
