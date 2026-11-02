from fastapi.testclient import TestClient
from api.app import app
from tests.test_api import auth_headers
from uuid import uuid4


def test_conversation_preserves_legacy_replies_and_is_private_and_idempotent():
    with TestClient(app) as client:
        admin = auth_headers(client)
        users = [client.post('/api/admin/users', headers=admin, json={
            'username': f'Thread {i}', 'email': f'thread-{i}@example.test',
            'password': 'Synthetic-thread-928!'}).json() for i in range(2)]
        member, stranger = [auth_headers(client, u['email'], 'Synthetic-thread-928!') for u in users]
        try:
            item = client.post('/api/feedback', headers=member, json={'subject': 'Conversation test', 'content': 'Original'}).json()
            path = f"/api/feedback/{item['id']}"
            legacy = client.put(path, headers=admin, json={'status': 'reviewing', 'reply': 'Existing answer'}).json()
            payload = {'content': 'New admin answer', 'request_id': str(uuid4())}
            posted = client.post(path + '/comments', headers=admin, json=payload)
            assert posted.status_code == 201, posted.text
            assert [c['content'] for c in posted.json()['comments']] == ['Existing answer', 'New admin answer']
            retry = client.post(path + '/comments', headers=admin, json=payload)
            assert len(retry.json()['comments']) == 2
            assert client.post(path + '/comments', headers=stranger, json={'content': 'No access', 'request_id': str(uuid4())}).status_code == 404
            mine = client.get('/api/feedback', headers=member).json()[0]
            assert mine['reply_unread'] is True
            assert client.post(path + '/read', headers=member, json={'reply_revision': legacy['reply_revision']}).status_code == 409
            assert client.post(path + '/read', headers=member, json={'reply_revision': mine['reply_revision']}).status_code == 200
            followup = client.post(path + '/comments', headers=member, json={'content': 'Thanks, one question', 'request_id': str(uuid4())}).json()
            assert followup['comments'][-1]['is_admin'] is False
            assert followup['status'] == 'reviewing'
            assert client.put(path, headers=member, json={'status': 'resolved'}).status_code == 403
            saved = client.put(path, headers=admin, json={'status': 'resolved', 'revision': followup['revision']}).json()
            assert len(saved['comments']) == 3
            assert client.get('/api/feedback', headers=stranger).json() == []
        finally:
            for person in users:
                assert client.delete(f"/api/admin/users/{person['id']}", headers=admin).status_code == 204


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
