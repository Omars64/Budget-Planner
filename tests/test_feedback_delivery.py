from fastapi.testclient import TestClient
from api.app import app
from tests.test_api import auth_headers


def test_reply_survives_status_edits_and_is_private_unread_and_conflict_safe():
    with TestClient(app) as client:
        admin = auth_headers(client)
        person = client.post('/api/admin/users', headers=admin, json={
            'username': 'Synthetic feedback recipient', 'email': 'reply-verification@example.test',
            'password': 'Synthetic-reply-928!'}).json()
        member = auth_headers(client, person['email'], 'Synthetic-reply-928!')
        try:
            item = client.post('/api/feedback', headers=member, json={'subject': 'Reply check', 'content': 'Synthetic only'}).json()
            path = f"/api/feedback/{item['id']}"
            saved = client.put(path, headers=admin, json={'status': 'reviewing', 'reply': 'Your issue is being fixed.', 'revision': item['revision']}).json()
            stale = client.put(path, headers=admin, json={'status': 'resolved', 'reply': 'Old admin draft', 'revision': item['revision']})
            assert stale.status_code == 409
            for payload in [{'status': 'resolved'}, {'status': 'reviewing', 'reply': ''}]:
                assert client.put(path, headers=admin, json=payload).json()['reply'] == saved['reply']
            row = client.get('/api/feedback', headers=member).json()[0]
            assert row['reply'] == saved['reply'] and row['reply_unread'] is True
            assert client.post(path + '/read', headers=admin, json={'reply_revision': row['reply_revision']}).status_code == 404
            assert client.post(path + '/read', headers=member, json={'reply_revision': row['reply_revision']}).json()['reply_unread'] is False
            changed = client.put(path, headers=admin, json={'status': 'resolved', 'reply': 'A newer answer.'}).json()
            assert client.post(path + '/read', headers=member, json={'reply_revision': row['reply_revision']}).status_code == 409
            reloaded = client.get('/api/feedback', headers=member).json()[0]
            assert reloaded['reply'] == changed['reply'] and reloaded['reply_unread'] is True
        finally:
            assert client.delete(f"/api/admin/users/{person['id']}", headers=admin).status_code == 204
