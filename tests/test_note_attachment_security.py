import pytest
from api.workspace import NoteIn, validate_note_attachment


@pytest.mark.parametrize('data,mime', [
    ('javascript:alert(1)', 'application/pdf'),
    ('https://example.test/file', 'application/pdf'),
    ('data:text/html;base64,PHNjcmlwdD4=', 'text/html'),
    ('data:application/pdf;base64,JVBERg==', 'image/png'),
    ('data:application/pdf;base64,!', 'application/pdf'),
    ('data:application/pdf;base64,YQ', 'application/pdf'),
])
def test_unsafe_attachment_rejected(data, mime):
    with pytest.raises(ValueError):
        NoteIn(title='Synthetic', attachment_data=data, attachment_type=mime)


def test_document_and_drawing_boundaries():
    validate_note_attachment('data:application/pdf;base64,JVBERg==', 'application/pdf')
    validate_note_attachment('data:image/png;base64,YQ==', 'image/png', 'drawing')
    with pytest.raises(ValueError):
        validate_note_attachment('data:application/pdf;base64,JVBERg==', 'application/pdf', 'drawing')


def test_attachment_access_upload_and_share_revocation():
    import os
    from fastapi.testclient import TestClient
    from api.app import app
    from tests.test_api import auth_headers
    with TestClient(app) as client:
        admin = auth_headers(client, os.environ['ADMIN_INITIAL_EMAIL'])
        people = []
        try:
            for name in ('attachment-owner', 'attachment-reader', 'attachment-outsider'):
                created = client.post('/api/admin/users', headers=admin, json={
                    'username': name, 'email': name + '@example.test', 'password': 'Attachment-test-123!'})
                assert created.status_code == 201, created.text
                person = created.json()
                people.append((person, auth_headers(client, person['email'], 'Attachment-test-123!')))
            owner, reader, outsider = [entry[1] for entry in people]
            payload = {'title': 'Private attachment', 'attachment_name': 'private.pdf',
                'attachment_type': 'application/pdf', 'attachment_data': 'data:application/pdf;base64,JVBERg=='}
            assert client.post('/api/notes', json=payload).status_code == 401
            rejected = client.post('/api/notes', headers=owner, json={**payload,
                'attachment_data': 'data:text/html;base64,PHNjcmlwdD4='})
            assert rejected.status_code == 422
            created = client.post('/api/notes', headers=owner, json=payload)
            assert created.status_code == 201, created.text
            note = created.json()
            path = f"/api/notes/{note['id']}"
            assert client.get(path, headers=outsider).status_code == 404
            assert client.put(path, headers=outsider, json=note).status_code == 404
            share = client.post(path + '/shares', headers=owner,
                json={'email': people[1][0]['email'], 'permission': 'view'})
            assert share.status_code == 201, share.text
            assert client.get(path, headers=reader).json()['attachment_data'] == payload['attachment_data']
            assert client.put(path, headers=reader, json=note).status_code == 403
            share_id = client.get(path, headers=owner).json()['shares'][0]['id']
            assert client.delete(path + f"/shares/{share_id}", headers=owner).status_code == 204
            assert client.get(path, headers=reader).status_code == 404
        finally:
            for person, _ in people:
                assert client.delete(f"/api/admin/users/{person['id']}", headers=admin).status_code == 204
