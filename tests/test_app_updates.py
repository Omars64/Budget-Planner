import copy
import json

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from api import app_updates as updates

RELEASE = {'schema': 1, 'packageId': 'com.flowbudget.app', 'version': '5.8.0', 'versionCode': 43,
           'size': 1024, 'sha256': 'a' * 64,
           'url': 'https://github.com/Omars64/Budget-Planner/releases/download/v5.8.0/Budgetly-5.8.0.apk'}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(updates, '_cache', {'until': 0, 'release': None})
    app = FastAPI()
    app.include_router(updates.router)
    with TestClient(app) as client:
        yield client


def test_public_metadata_cache_and_no_authentication(client, monkeypatch):
    calls = []
    monkeypatch.setattr(updates, 'load_release', lambda: calls.append(1) or copy.deepcopy(RELEASE))
    first = client.get('/api/app-updates/latest')
    assert first.status_code == 200
    assert first.json() == RELEASE
    assert first.headers['cache-control'] == 'public, max-age=0, s-maxage=300'
    assert client.get('/api/app-updates/latest').json() == RELEASE
    assert calls == [1]


def test_absent_release_and_outage_are_safe(client, monkeypatch):
    monkeypatch.setattr(updates, 'load_release', lambda: None)
    assert client.get('/api/app-updates/latest').status_code == 404
    updates._cache['until'] = 0
    def fail():
        raise RuntimeError('private provider details')
    monkeypatch.setattr(updates, 'load_release', fail)
    response = client.get('/api/app-updates/latest')
    assert response.status_code == 503
    assert 'private' not in response.text


@pytest.mark.parametrize('field,value', [('size', True), ('size', 268435457), ('versionCode', 0),
    ('sha256', 'bad'), ('packageId', 'other'), ('url', 'https://evil.example/app.apk'),
    ('url', RELEASE['url'] + '?secret=x'), ('url', RELEASE['url'].replace('github.com', 'github.com:443'))])
def test_reject_invalid_release(field, value):
    with pytest.raises(ValueError):
        updates.validate_release({**RELEASE, field: value})


def test_bounded_redirects_and_no_user_headers(monkeypatch):
    real_client = httpx.Client
    calls = []
    def handle(request):
        calls.append(request)
        if request.url.host == 'github.com':
            return httpx.Response(302, headers={'location': 'https://release-assets.githubusercontent.com/manifest'})
        return httpx.Response(200, json=RELEASE)
    monkeypatch.setattr(updates.httpx, 'Client', lambda **kwargs: real_client(transport=httpx.MockTransport(handle), **kwargs))
    assert updates.load_release() == RELEASE
    assert len(calls) == 2
    assert all('authorization' not in request.headers and 'cookie' not in request.headers for request in calls)


def test_reject_untrusted_redirect_and_oversized_response(monkeypatch):
    real_client = httpx.Client
    def redirect(request):
        return httpx.Response(302, headers={'location': 'http://127.0.0.1/private'})
    monkeypatch.setattr(updates.httpx, 'Client', lambda **kwargs: real_client(transport=httpx.MockTransport(redirect), **kwargs))
    with pytest.raises(ValueError):
        updates.load_release()
    monkeypatch.setattr(updates.httpx, 'Client', lambda **kwargs: real_client(transport=httpx.MockTransport(lambda req: httpx.Response(200, content=b'x' * 16385)), **kwargs))
    with pytest.raises(ValueError):
        updates.load_release()
