from fastapi.testclient import TestClient
from api.app import app
from tests.test_api import auth_headers


def test_appearance_and_reminder_preferences_persist():
    with TestClient(app) as client:
        headers = auth_headers(client)
        original = client.get('/api/settings', headers=headers).json()
        changed = {**original, 'theme': 'dark', 'wallpaper_enabled': True,
                   'wallpaper_style': 'budgetly',
                   'reminder_interval_hours': 4, 'reminder_time': '08:00'}
        try:
            saved = client.put('/api/settings', headers=headers, json=changed)
            assert saved.status_code == 200, saved.text
            loaded = client.get('/api/settings', headers=headers).json()
            for key in ('theme', 'wallpaper_enabled', 'wallpaper_style', 'reminder_interval_hours', 'reminder_time'):
                assert loaded[key] == changed[key]
            disabled = client.put('/api/settings', headers=headers, json={'wallpaper_enabled': False, 'wallpaper_style': 'none'})
            assert disabled.status_code == 200, disabled.text
            assert client.get('/api/settings', headers=headers).json()['wallpaper_style'] == 'none'
            assert client.put('/api/settings', headers=headers, json={**changed, 'reminder_interval_hours': 0}).status_code == 422
        finally:
            client.put('/api/settings', headers=headers, json=original)
