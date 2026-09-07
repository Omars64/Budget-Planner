import base64
import hashlib
import json
import secrets
import cbor2
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import hashes
from fastapi.testclient import TestClient
from api.app import app
from tests.test_api import auth_headers

def enc(value):
    return base64.urlsafe_b64encode(value).decode().rstrip('=')

def test_passkey_registration_login_replay_and_revocation():
    with TestClient(app) as client:
        headers = auth_headers(client)
        assert client.post('/api/passkeys/register/options', headers=headers, json={'password':'incorrect-password'}).status_code == 401
        options = client.post('/api/passkeys/register/options', headers=headers, json={'password':'FlowBudgetAdmin!ChangeMe2026'}).json()
        key = ec.generate_private_key(ec.SECP256R1())
        public = key.public_key().public_numbers()
        cose = cbor2.dumps({1:2, 3:-7, -1:1, -2:public.x.to_bytes(32,'big'), -3:public.y.to_bytes(32,'big')})
        credential_id = secrets.token_bytes(32)
        rp_hash = hashlib.sha256(b'budget-planner-ecru-seven.vercel.app').digest()
        client_data = json.dumps({'type':'webauthn.create','challenge':options['options']['challenge'],'origin':'https://budget-planner-ecru-seven.vercel.app'}).encode()
        auth_data = rp_hash + bytes([0x45]) + (0).to_bytes(4,'big') + bytes(16) + len(credential_id).to_bytes(2,'big') + credential_id + cose
        credential = {'id':enc(credential_id),'rawId':enc(credential_id),'type':'public-key','response':{'clientDataJSON':enc(client_data),'attestationObject':enc(cbor2.dumps({'fmt':'none','attStmt':{},'authData':auth_data}))}}
        registered = client.post('/api/passkeys/register/verify', headers=headers, json={'challenge_id':options['challenge_id'],'credential':credential})
        assert registered.status_code == 200, registered.text
        options = client.post('/api/passkeys/login/options').json()
        client_data = json.dumps({'type':'webauthn.get','challenge':options['options']['challenge'],'origin':'https://budget-planner-ecru-seven.vercel.app'}).encode()
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
