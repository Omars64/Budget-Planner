from fastapi.testclient import TestClient
from api.app import app


def login(client, email, password="StrongPass123!"):
    response = client.post('/api/auth/login', json={'email': email, 'password': password})
    assert response.status_code == 200, response.text
    return {'Authorization': 'Bearer ' + response.json()['token']}


def test_notes_permissions_conflicts_folders_and_user_cleanup():
    with TestClient(app) as client:
        admin = login(client, 'omarsolanki46@gmail.com', 'FlowBudgetAdmin!ChangeMe2026')
        people = []
        for name in ['note-owner', 'note-member', 'note-stranger']:
            row = client.post('/api/admin/users', headers=admin, json={'username': name, 'email': name + '@example.com', 'password': 'StrongPass123!'}).json()
            people.append((row['id'], login(client, row['email'])))
        owner, member, stranger = [p[1] for p in people]
        folder = client.post('/api/note-folders', headers=owner, json={'name': 'Plans'}).json()
        note = client.post('/api/notes', headers=owner, json={'title': 'Plan', 'content': 'Private', 'folder_id': folder['id']}).json()
        path = f"/api/notes/{note['id']}"
        assert client.get('/api/notes', headers=stranger).json() == []
        assert client.put(path, headers=stranger, json=note).status_code == 404
        assert client.post('/api/notes', headers=member, json={'title': 'Oops', 'folder_id': folder['id']}).status_code == 404
        invite = {'email': 'note-member@example.com', 'permission': 'view'}
        assert client.post(path + '/shares', headers=owner, json=invite).status_code == 201
        shared = client.get('/api/notes', headers=member).json()[0]
        assert shared['folder_id'] is None and not shared['can_edit']
        assert client.put(path, headers=member, json=shared).status_code == 403
        assert client.delete(path, headers=member).status_code == 403
        assert client.post(path + '/shares', headers=member, json=invite).status_code == 403
        client.post(path + '/shares', headers=owner, json={**invite, 'permission': 'edit'})
        changed = client.put(path, headers=member, json={**shared, 'content': 'Collaborator edit'})
        assert changed.status_code == 200, changed.text
        assert client.put(path, headers=owner, json=note).status_code == 409
        assert client.get('/api/notes', headers=owner).json()[0]['content'] == 'Collaborator edit'
        latest = client.get('/api/notes', headers=owner).json()[0]
        share_id = latest['shares'][0]['id']
        assert client.delete(path + f'/shares/{share_id}', headers=owner).status_code == 204
        assert client.get('/api/notes', headers=member).json() == []
        assert client.put(path, headers=member, json=latest).status_code == 404
        assert client.delete(f"/api/note-folders/{folder['id']}", headers=owner).status_code == 204
        assert client.get('/api/notes', headers=owner).json()[0]['folder_id'] is None
        client.post(path + '/shares', headers=owner, json=invite)
        for user_id, _ in people:
            assert client.delete(f'/api/admin/users/{user_id}', headers=admin).status_code == 204


def test_feedback_privacy_reply_rate_limit_and_password_session_invalidation():
    with TestClient(app) as client:
        admin = login(client, 'omarsolanki46@gmail.com', 'FlowBudgetAdmin!ChangeMe2026')
        user = client.post('/api/admin/users', headers=admin, json={'username': 'Feedback user', 'email': 'feedback-user@example.com', 'password': 'StrongPass123!'}).json()
        member = login(client, user['email'])
        assert client.get('/api/notes').status_code == 401
        item = client.post('/api/feedback', headers=member, json={'subject': 'Mobile', 'content': 'A useful suggestion'}).json()
        update = {'status': 'resolved', 'reply': 'Thank you, implemented.'}
        assert client.put(f"/api/feedback/{item['id']}", headers=member, json=update).status_code == 403
        assert client.put(f"/api/feedback/{item['id']}", headers=admin, json=update).status_code == 200
        rows = client.get('/api/feedback', headers=member).json()
        assert len(rows) == 1 and rows[0]['reply'] == update['reply']
        for _ in range(2):
            assert client.post('/api/feedback', headers=member, json={'subject': 'Test', 'content': 'Test'}).status_code == 201
        assert client.post('/api/feedback', headers=member, json={'subject': 'Test', 'content': 'Test'}).status_code == 429
        assert client.put(f"/api/admin/users/{user['id']}", headers=admin, json={**user, 'password': 'NewStrongPass123!'}).status_code == 200
        assert client.get('/api/auth/me', headers=member).status_code == 401
        assert client.delete(f"/api/admin/users/{user['id']}", headers=admin).status_code == 204


def test_wallet_delete_recovery_and_explicit_workspace_clear():
    with TestClient(app) as client:
        admin = login(client, 'omarsolanki46@gmail.com', 'FlowBudgetAdmin!ChangeMe2026')
        user = client.post('/api/admin/users', headers=admin, json={'username': 'Safety user', 'email': 'safety-user@example.com', 'password': 'StrongPass123!'}).json()
        member = login(client, user['email'])
        wallet = client.get('/api/wallets', headers=member).json()[0]
        category = client.get('/api/categories?kind=expense', headers=member).json()[0]
        tx = {'type': 'expense', 'amount': 4, 'description': 'Wallet deletion guard', 'notes': '', 'date': '2026-09-03T12:00:00', 'wallet_id': wallet['id'], 'transfer_wallet_id': None, 'category_id': category['id'], 'recurring_frequency': 'none', 'recurring_until': None}
        assert client.post('/api/transactions', headers=member, json=tx).status_code == 201
        assert client.delete(f"/api/wallets/{wallet['id']}", headers=member).status_code == 409
        assert client.delete(f"/api/wallets/{wallet['id']}?delete_transactions=true", headers=member).status_code == 204
        assert all(row['id'] != wallet['id'] for row in client.get('/api/wallets', headers=member).json())
        assert any('Deleted wallet' in item['reason'] for item in client.get('/api/recovery', headers=member).json())

        note = client.post('/api/notes', headers=member, json={'title': 'Clear me', 'content': 'Temporary'}).json()
        cleared = client.post('/api/workspace/clear', headers=member, json={'confirmation': 'CLEAR', 'scope': 'workspace'})
        assert cleared.status_code == 200 and cleared.json()['recovery_id']
        assert client.get('/api/notes', headers=member).json() == []
        assert client.get(f"/api/recovery/{cleared.json()['recovery_id']}", headers=member).json()['notes'][0]['id'] == note['id']
        assert client.delete(f"/api/admin/users/{user['id']}", headers=admin).status_code == 204
