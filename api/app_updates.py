"""Public, bounded proxy for the pinned Android release metadata; no user data."""
import json
import re
import time
from threading import Lock
from urllib.parse import urljoin, urlsplit

import httpx
from fastapi import APIRouter, HTTPException, Response

router = APIRouter()
MANIFEST_URL = 'https://github.com/Omars64/Budget-Planner/releases/latest/download/update.json'
ALLOWED_HOSTS = {'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'}
_cache = {'until': 0, 'release': None}
_lock = Lock()


def validate_release(value):
    if not isinstance(value, dict):
        raise ValueError('Invalid release')
    url = urlsplit(value.get('url', ''))
    prefix = '/Omars64/Budget-Planner/releases/download/'
    if (value.get('schema') != 1 or value.get('packageId') != 'com.flowbudget.app'
            or not isinstance(value.get('version'), str) or not re.fullmatch(r'\d+\.\d+\.\d+', value['version'])
            or type(value.get('versionCode')) is not int or value['versionCode'] < 1
            or type(value.get('size')) is not int or not 0 < value['size'] <= 268435456
            or not isinstance(value.get('sha256'), str) or not re.fullmatch(r'[a-f0-9]{64}', value['sha256'])
            or url.scheme != 'https' or url.netloc != 'github.com' or url.query or url.fragment
            or not url.path.startswith(prefix) or not url.path.endswith('.apk')
            or len(url.path[len(prefix):].split('/')) != 2 or '..' in url.path
            or '%2f' in url.path.lower()):
        raise ValueError('Invalid release')
    return {key: value[key] for key in ('schema', 'packageId', 'version', 'versionCode', 'size', 'sha256', 'url')}


def load_release():
    url = MANIFEST_URL
    with httpx.Client(timeout=10, follow_redirects=False, trust_env=False) as client:
        for _ in range(6):
            parsed = urlsplit(url)
            if parsed.scheme != 'https' or parsed.hostname not in ALLOWED_HOSTS or parsed.username or parsed.password or parsed.port:
                raise ValueError('Unexpected release redirect')
            with client.stream('GET', url, headers={'Accept-Encoding': 'identity', 'User-Agent': 'Budgetly-Release-Check'}) as reply:
                if reply.status_code == 404:
                    return None
                if reply.status_code in (301, 302, 303, 307, 308):
                    location = reply.headers.get('location')
                    if not location:
                        raise ValueError('Missing release redirect')
                    url = urljoin(url, location)
                    continue
                reply.raise_for_status()
                body = bytearray()
                for chunk in reply.iter_bytes():
                    body.extend(chunk)
                    if len(body) > 16384:
                        raise ValueError('Oversized release metadata')
                return validate_release(json.loads(body))
    raise ValueError('Too many release redirects')


@router.get('/api/app-updates/latest')
def latest_release(response: Response):
    with _lock:
        if _cache['until'] <= time.monotonic():
            try:
                _cache['release'] = load_release()
                _cache['until'] = time.monotonic() + 300
            except Exception:
                raise HTTPException(503, 'Update checks are temporarily unavailable. Please retry.') from None
        release = _cache['release']
    response.headers['Cache-Control'] = 'public, max-age=0, s-maxage=300'
    if release is None:
        response.status_code = 404
        return {'detail': 'No published Android release yet.'}
    return release
