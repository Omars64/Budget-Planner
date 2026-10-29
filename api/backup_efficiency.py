"""Private backup optimization metadata; never stores plaintext financial data."""
from contextlib import closing
from datetime import timedelta, timezone
import gzip
import hashlib
import json
import logging
import os
import io

STATE_KEY = 'budgetly/backup-efficiency.json.gz.enc'


def epoch(now):
    return now.replace(tzinfo=timezone.utc).timestamp() if now.tzinfo is None else now.timestamp()


def policy():
    from . import resource_control
    state = resource_control.read_state()
    # An unavailable policy must not reduce recovery protection.
    if not state['coordination']['healthy']:
        return {'backup_interval_hours': 24, 'backup_skip_unchanged': False}
    return state['policy']


def metric(name):
    try:
        from .resource_control import record_metric
        record_metric(name)
    except Exception:
        pass  # Monitoring must never turn a verified backup into a failure.


def update_digest(digest, identity, data):
    stable = {key: value for key, value in data.items() if key != 'exported_at'}
    part = json.dumps({'identity': identity, 'data': stable}, sort_keys=True,
                      separators=(',', ':'), ensure_ascii=True).encode()
    digest.update(len(part).to_bytes(8, 'big'))
    digest.update(part)


def read_state(client, cipher, now):
    try:
        with closing(client.get_object(Bucket=os.environ['BACKUP_S3_BUCKET'], Key=STATE_KEY)['Body']) as body:
            encrypted = body.read(16_385)
        if len(encrypted) > 16_384:
            return None
        compressed = cipher.decrypt(encrypted)
        # State is tiny and authenticated; still bound decompression.
        with gzip.GzipFile(fileobj=io.BytesIO(compressed)) as archive:
            raw = archive.read(8193)
        if len(raw) > 8192:
            return None
        value = json.loads(raw)
        full_at = value.get('full_at')
        key, digest = value.get('manifest_key'), value.get('digest')
        parts = key.split('/') if isinstance(key, str) else []
        if (value.get('version') != 1 or type(full_at) not in (int, float)
                or not epoch(now) - timedelta(days=7).total_seconds() < full_at <= epoch(now)
                or len(parts) != 4 or parts[0] != 'budgetly' or parts[-1] != 'manifest.json.gz.enc'
                or any(part in ('', '.', '..') for part in parts)
                or not isinstance(digest, str) or len(digest) != 64
                or any(c not in '0123456789abcdef' for c in digest)):
            return None
        return value
    except Exception:
        return None  # Missing/corrupt metadata forces a fresh full backup.


def verify_existing(client, cipher, manifest_key, expected_digest, expected_count):
    """Authenticate a complete same-run archive set and compare its actual data."""
    def read(key):
        with closing(client.get_object(Bucket=os.environ['BACKUP_S3_BUCKET'], Key=key)['Body']) as body:
            encrypted = bytearray()
            while len(encrypted) <= 40_000_000:
                chunk = body.read(min(65536, 40_000_001 - len(encrypted)))
                if not chunk:
                    break
                encrypted.extend(chunk)
        if len(encrypted) > 40_000_000:
            raise ValueError('Backup archive too large')
        with gzip.GzipFile(fileobj=io.BytesIO(cipher.decrypt(bytes(encrypted)))) as archive:
            raw = archive.read(25_000_001)
        if len(raw) > 25_000_000:
            raise ValueError('Backup data too large')
        return json.loads(raw), encrypted

    manifest, _ = read(manifest_key)
    accounts = manifest.get('accounts') if isinstance(manifest, dict) else None
    if (manifest.get('version') != 1 or manifest.get('kind') != 'budgetly-account-recovery-manifest'
            or not isinstance(accounts, list) or len(accounts) != expected_count):
        return False
    prefix = manifest_key.rsplit('/', 1)[0]
    actual = hashlib.sha256()
    seen = set()
    for row in sorted(accounts, key=lambda item: item['id']):
        uid = row['id']
        if type(uid) is not int or uid <= 0 or uid in seen or row['archive_key'] != f'{prefix}/user-{uid}.json.gz.enc':
            return False
        seen.add(uid)
        data, encrypted = read(row['archive_key'])
        if (type(row.get('archive_bytes')) is not int or len(encrypted) != row['archive_bytes']
                or hashlib.sha256(encrypted).hexdigest() != row.get('archive_sha256')
                or not isinstance(data, dict) or data.get('version') != 1):
            return False
        update_digest(actual, {key: row[key] for key in ('id', 'email', 'username', 'role')}, data)
    return actual.hexdigest() == expected_digest


def write_state(client, cipher, digest, manifest_key, now):
    value = {'version': 1, 'digest': digest, 'manifest_key': manifest_key,
             'full_at': epoch(now)}
    upload = {'Bucket': os.environ['BACKUP_S3_BUCKET'], 'Key': STATE_KEY,
              'Body': cipher.encrypt(gzip.compress(json.dumps(value).encode())),
              'ContentType': 'application/octet-stream'}
    if not os.getenv('BACKUP_S3_ENDPOINT_URL'):
        upload['ServerSideEncryption'] = 'AES256'
    try:
        client.put_object(**upload)
    except Exception:
        logging.getLogger('flowbudget').warning('Backup optimization metadata unavailable')
    # The next optimization authenticates this metadata AND verifies its full run.
