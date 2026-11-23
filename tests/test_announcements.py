from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from api.app import app
from api.auth_dependency import current_user
from api.database import Base, get_db
from api.models import User


def test_announcement_recipients_are_scoped_and_read_state_is_per_account(monkeypatch):
    engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine) as db, TestClient(app) as client:
        sender, admin, user, inactive = [
            User(username=name, email=f'{name.lower()}@example.test', password_hash='unused', role=role, active=active)
            for name, role, active in [('Sender', 'admin', True), ('Admin', 'admin', True), ('User', 'user', True), ('Inactive', 'user', False)]
        ]
        db.add_all([sender, admin, user, inactive])
        db.commit()
        actor = {'user': user}
        monkeypatch.setitem(app.dependency_overrides, get_db, lambda: db)
        monkeypatch.setitem(app.dependency_overrides, current_user, lambda: actor['user'])
        endpoint = '/api/admin/announcements'
        inbox = '/api/announcements'
        payload = {'title': 'Maintenance', 'message': 'Service will resume in an hour.', 'audience': 'everyone'}
        assert client.post(endpoint, json=payload).status_code == 403
        assert client.get(endpoint).status_code == 403
        actor['user'] = sender
        assert client.post(endpoint, json={**payload, 'message': '  '}).status_code == 422
        headers = {'Idempotency-Key': 'maintenance-1'}
        sent = client.post(endpoint, json=payload, headers=headers)
        assert sent.status_code == 200, sent.text
        announcement = sent.json()
        assert announcement['recipient_count'] == 2
        assert client.post(endpoint, json=payload, headers=headers).json() == announcement
        assert client.post(endpoint, json={**payload, 'audience': 'admins'}, headers=headers).status_code == 409
        assert client.get(endpoint).json() == [announcement]
        assert client.get(inbox).json() == {'items': [], 'next': None}
        read = f'{inbox}/{announcement["id"]}/read'
        assert client.put(read).status_code == 404

        targeted = client.post(endpoint, json={**payload, 'audience': 'admins'}).json()
        assert targeted['recipient_count'] == 1
        actor['user'] = user
        assert client.get(inbox + '/unread').json() == {'count': 1}
        received = client.get(inbox).json()['items']
        assert [(row['id'], row['read']) for row in received] == [(announcement['id'], False)]
        assert client.put(f'{inbox}/{targeted["id"]}/read').status_code == 404
        assert client.put(read).json() == client.put(read).json() == {'read': True}
        assert client.get(inbox + '/unread').json() == {'count': 0}
        assert client.get(inbox).json()['items'][0]['read'] is True
        actor['user'] = admin
        assert client.get(inbox + '/unread').json() == {'count': 2}
        actor['user'] = inactive
        assert client.get(inbox + '/unread').json() == {'count': 0}
