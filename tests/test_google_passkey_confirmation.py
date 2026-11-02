from datetime import timedelta
from fastapi.testclient import TestClient
from api.app import app
from api.database import SessionLocal
from api.models import User, utc_now
from api.google_auth import GoogleIdentity
from api.reliability_models import AccountSession
from tests.test_api import auth_headers


def test_google_only_registration_requires_fresh_same_account_session_confirmation():
    with TestClient(app) as client:
        admin = auth_headers(client)
        person = client.post('/api/admin/users', headers=admin, json={
            'username': 'Synthetic Google passkey', 'email': 'google-passkey@example.test',
            'password': 'Synthetic-passkey-928!'}).json()
        with SessionLocal() as db:
            user = db.get(User, person['id'])
            user.password_hash = ''
            db.add(GoogleIdentity(subject='synthetic-passkey-subject', user_id=user.id, email=user.email, signup=True))
            db.commit()
            from api.index import issue_token
            token = issue_token(user)
        with SessionLocal() as db:
            db.query(AccountSession).filter_by(user_id=person['id']).update({'verified_at': None})
            db.commit()
        headers = {'Authorization': 'Bearer ' + token}
        try:
            assert client.post('/api/passkeys/register/options', headers=headers, json={}).status_code == 428
            with SessionLocal() as db:
                own = db.query(AccountSession).filter_by(user_id=person['id']).one()
                own.verified_at = utc_now() - timedelta(minutes=6)
                db.commit()
            assert client.post('/api/passkeys/register/options', headers=headers, json={}).status_code == 428
            with SessionLocal() as db:
                own = db.query(AccountSession).filter_by(user_id=person['id']).one()
                own.verified_at = utc_now()
                db.commit()
            result = client.post('/api/passkeys/register/options', headers=headers, json={})
            assert result.status_code == 200, result.text
            assert result.json()['options']['authenticatorSelection']['userVerification'] == 'required'
            with SessionLocal() as db:
                db.query(AccountSession).filter_by(user_id=person['id']).update({'revoked': True})
                db.commit()
            assert client.post('/api/passkeys/register/options', headers=headers, json={}).status_code == 401
        finally:
            # Synthetic Google identity has no provider grant to revoke.
            with SessionLocal() as db:
                db.query(GoogleIdentity).filter_by(user_id=person['id']).delete()
                db.commit()
            assert client.delete(f"/api/admin/users/{person['id']}", headers=admin).status_code == 204
