import base64
import hashlib
import json
import secrets
import cbor2
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import hashes
from fastapi.testclient import TestClient
from tests.test_api import auth_headers
from api.app import app
from api.android_identity import ANDROID_ORIGIN, ANDROID_CERT_SHA256

def enc(value):
    return base64.urlsafe_b64encode(value).decode().rstrip('=')

@pytest.mark.parametrize('credential_origin', ['https://budget-planner-ecru-seven.vercel.app', ANDROID_ORIGIN])
def test_passkey_registration_login_replay_and_revocation(credential_origin):
    with TestClient(app) as client:
        headers = auth_headers(client)
        assert client.post('/api/passkeys/register/options', headers=headers, json={'password':'incorrect-password'}).status_code == 401
        options = client.post('/api/passkeys/register/options', headers=headers, json={'password':'FlowBudgetAdmin!ChangeMe2026'}).json()
        key = ec.generate_private_key(ec.SECP256R1())
        public = key.public_key().public_numbers()
        cose = cbor2.dumps({1:2, 3:-7, -1:1, -2:public.x.to_bytes(32,'big'), -3:public.y.to_bytes(32,'big')})
        credential_id = secrets.token_bytes(32)
        rp_hash = hashlib.sha256(b'budget-planner-ecru-seven.vercel.app').digest()
        client_data = json.dumps({'type':'webauthn.create','challenge':options['options']['challenge'],'origin':credential_origin}).encode()
        auth_data = rp_hash + bytes([0x45]) + (0).to_bytes(4,'big') + bytes(16) + len(credential_id).to_bytes(2,'big') + credential_id + cose
        credential = {'id':enc(credential_id),'rawId':enc(credential_id),'type':'public-key','response':{'clientDataJSON':enc(client_data),'attestationObject':enc(cbor2.dumps({'fmt':'none','attStmt':{},'authData':auth_data}))}}
        registered = client.post('/api/passkeys/register/verify', headers=headers, json={'challenge_id':options['challenge_id'],'credential':credential})
        assert registered.status_code == 200, registered.text
        # A second device must not replace the first device's credential.
        second_id = register_second_device(client, headers)
        exclusions = client.post('/api/passkeys/register/options', headers=headers, json={'password':'FlowBudgetAdmin!ChangeMe2026'}).json()['options']['excludeCredentials']
        assert {item['id'] for item in exclusions} == {enc(credential_id), second_id}
        # Existing server registrations migrate without requiring re-enrollment.
        from api.database import SessionLocal
        from api.models import AppSetting
        from api.passkeys import Passkey, migrate_passkeys
        with SessionLocal() as db:
            row = db.get(Passkey, enc(credential_id))
            db.add(AppSetting(user_id=row.user_id, key='passkey', value=json.dumps({'id':row.id, 'key':row.public_key, 'count':row.sign_count})))
            db.delete(row)
            db.commit()
            migrate_passkeys(db)
            migrate_passkeys(db)
            db.commit()
            assert db.get(Passkey, enc(credential_id)) is not None
        # Workbook restores must never erase or import account credentials.
        restored = client.post('/api/backup/restore', headers=headers, json={'version':1, 'settings':{'passkey':'untrusted'}})
        assert restored.status_code == 200, restored.text
        with SessionLocal() as db:
            assert db.query(Passkey).count() == 2
            assert db.query(AppSetting).filter_by(key='passkey').count() == 0
        options = client.post('/api/passkeys/login/options').json()
        client_data = json.dumps({'type':'webauthn.get','challenge':options['options']['challenge'],'origin':credential_origin}).encode()
        auth_data = rp_hash + bytes([5]) + (1).to_bytes(4,'big')
        signature = key.sign(auth_data + hashlib.sha256(client_data).digest(), ec.ECDSA(hashes.SHA256()))
        credential['response'] = {'clientDataJSON':enc(client_data),'authenticatorData':enc(auth_data),'signature':enc(signature)}
        payload = {'challenge_id':options['challenge_id'],'credential':credential}
        result = client.post('/api/passkeys/login/verify',json=payload)
        assert result.status_code == 200, result.text
        assert client.get('/api/auth/me',headers={'Authorization':'Bearer '+result.json()['token']}).status_code == 200
        assert client.post('/api/passkeys/login/verify',json=payload).status_code == 400
        options = client.post('/api/passkeys/login/options').json()
        credential['response']['signature'] = enc(bytes(64))
        assert client.post('/api/passkeys/login/verify',json={'challenge_id':options['challenge_id'],'credential':credential}).status_code == 401
        assert client.delete('/api/passkeys',headers=headers).status_code == 204
        assert client.get('/api/passkeys',headers=headers).json() == {'enabled':False}
        options = client.post('/api/passkeys/login/options').json()
        rejected = client.post('/api/passkeys/login/verify', json={'challenge_id':options['challenge_id'], 'credential':credential})
        assert rejected.status_code == 401
        assert 'Settings > Biometric sign-in' in rejected.json()['detail']


def register_second_device(client, headers, credential_origin='https://budget-planner-ecru-seven.vercel.app', expected_status=200):
    options = client.post('/api/passkeys/register/options', headers=headers, json={'password':'FlowBudgetAdmin!ChangeMe2026'}).json()
    key = ec.generate_private_key(ec.SECP256R1())
    public = key.public_key().public_numbers()
    cose = cbor2.dumps({1:2, 3:-7, -1:1, -2:public.x.to_bytes(32,'big'), -3:public.y.to_bytes(32,'big')})
    credential_id = secrets.token_bytes(32)
    client_data = json.dumps({'type':'webauthn.create', 'challenge':options['options']['challenge'], 'origin':credential_origin}).encode()
    auth_data = hashlib.sha256(b'budget-planner-ecru-seven.vercel.app').digest() + bytes([0x45]) + bytes(4) + bytes(16) + len(credential_id).to_bytes(2,'big') + credential_id + cose
    credential = {'id':enc(credential_id), 'rawId':enc(credential_id), 'type':'public-key', 'response':{'clientDataJSON':enc(client_data), 'attestationObject':enc(cbor2.dumps({'fmt':'none', 'attStmt':{}, 'authData':auth_data}))}}
    result = client.post('/api/passkeys/register/verify', headers=headers, json={'challenge_id':options['challenge_id'], 'credential':credential})
    assert result.status_code == expected_status, result.text
    return enc(credential_id)


def test_untrusted_android_signer_and_localhost_cannot_register():
    with TestClient(app) as client:
        headers = auth_headers(client)
        register_second_device(client, headers, 'android:apk-key-hash:' + enc(bytes(32)), 400)
        register_second_device(client, headers, 'https://localhost', 400)


def test_public_asset_links_matches_only_the_release_identity(monkeypatch):
    with TestClient(app) as client:
        response = client.get('/.well-known/assetlinks.json')
        assert response.status_code == 200
        assert response.headers['content-type'] == 'application/json'
        assert response.json()[0]['target'] == {'namespace':'android_app', 'package_name':'com.flowbudget.app', 'sha256_cert_fingerprints':[ANDROID_CERT_SHA256]}
        from api.passkeys import trusted_origins
        monkeypatch.setenv('WEBAUTHN_ORIGIN', 'https://preview.example.com')
        assert trusted_origins() == ['https://preview.example.com']
        assert client.get('/.well-known/assetlinks.json').json() == []
