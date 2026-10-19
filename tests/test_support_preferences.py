from fastapi.testclient import TestClient
from api.app import app
from tests.test_api import auth_headers


def test_support_preferences_are_persistent_private_and_role_checked():
    with TestClient(app) as client:
        admin = auth_headers(client)
        original = client.get('/api/settings', headers=admin).json()
        created = client.post('/api/admin/users', headers=admin, json={
            'username': 'Support preferences', 'email': 'support-prefs@example.test',
            'password': 'PreviewSupport123!', 'role': 'user', 'active': True})
        assert created.status_code == 201, created.text
        user = auth_headers(client, 'support-prefs@example.test', 'PreviewSupport123!')
        try:
            before = client.get('/api/settings', headers=user).json()
            assert before['support_popup_enabled'] is True
            assert 'support_sidebar_enabled' not in before
            assert client.put('/api/settings', headers=user, json={'support_popup_enabled': False}).status_code == 200
            assert client.get('/api/settings', headers=user).json()['support_popup_enabled'] is False
            assert client.put('/api/settings', headers=user, json={'currency': 'USD'}).status_code == 200
            assert client.get('/api/settings', headers=user).json()['support_popup_enabled'] is False
            denied = client.put('/api/settings', headers=user, json={'support_popup_enabled': True, 'support_sidebar_enabled': False})
            assert denied.status_code == 403
            assert client.get('/api/settings', headers=user).json()['support_popup_enabled'] is False
            assert client.put('/api/settings', headers=admin, json={'support_sidebar_enabled': False}).status_code == 200
            assert client.get('/api/settings', headers=admin).json()['support_sidebar_enabled'] is False
            assert 'support_sidebar_enabled' not in client.get('/api/settings', headers=user).json()
            # Regular users can round-trip their whole settings without an admin-only field.
            saved = client.get('/api/settings', headers=user).json()
            assert client.put('/api/settings', headers=user, json=saved).status_code == 200
        finally:
            client.put('/api/settings', headers=admin, json=original)
