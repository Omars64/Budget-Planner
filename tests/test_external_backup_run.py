"""Completed off-site runs are authenticated as a set without extracting records."""
import gzip
import hashlib
import io
import json

import pytest
from cryptography.fernet import Fernet, InvalidToken
from scripts.verify_external_backup import verify_run


def stored_run(legacy=False):
    secret = Fernet.generate_key()
    prefix = 'budgetly/2026-10-28/test-run'
    manifest_key = prefix + '/manifest.json.gz.enc'
    def encrypt(data):
        return Fernet(secret).encrypt(gzip.compress(json.dumps(data).encode()))
    workspace = {'version': 1, 'settings': {}, **{name: [] for name in
        ('wallets', 'categories', 'transactions', 'budgets', 'goals', 'debts')}}
    objects, accounts = {}, []
    for user in (1, 2):
        key = f'{prefix}/user-{user}.json.gz.enc'
        objects[key] = encrypt(workspace)
        row = {'id': user, 'email': f'user{user}@synthetic.test', 'username': 'Synthetic',
               'role': 'user', 'archive_key': key}
        if not legacy:
            row.update(archive_bytes=len(objects[key]),
                       archive_sha256=hashlib.sha256(objects[key]).hexdigest())
        accounts.append(row)
    manifest = {'version': 1, 'kind': 'budgetly-account-recovery-manifest', 'accounts': accounts}
    objects[manifest_key] = encrypt(manifest)
    reads, streams = [], []
    class Storage:
        def get_object(self, *, Bucket, Key):
            assert Bucket == 'synthetic-private'
            reads.append(Key)
            stream = io.BytesIO(objects[Key])
            streams.append(stream)
            return {'Body': stream}
    return secret, manifest_key, objects, manifest, encrypt, Storage(), reads, streams


@pytest.mark.parametrize('legacy', [False, True])
def test_completed_run_checks_every_archive_and_closes_streams(legacy):
    secret, key, objects, _, _, client, reads, streams = stored_run(legacy)
    result = verify_run(client, 'synthetic-private', key, secret)
    assert result == {'verified': True, 'accounts': 2,
        'records': dict.fromkeys(('wallets', 'transactions', 'spaces', 'receipts', 'notes'), 0),
        'integrity_metadata': not legacy}
    assert len(reads) == len(objects) == 3
    assert all(stream.closed for stream in streams)


@pytest.mark.parametrize('defect', ['missing', 'corrupt', 'other-run', 'size', 'digest', 'partial', 'null'])
def test_incomplete_or_mismatched_run_cannot_pass(defect):
    secret, key, objects, manifest, encrypt, client, reads, streams = stored_run()
    account = manifest['accounts'][1]
    if defect == 'missing':
        del objects[account['archive_key']]
    elif defect == 'corrupt':
        objects[account['archive_key']] = b'corrupt'
    elif defect == 'other-run':
        account['archive_key'] = 'budgetly/2026-10-27/another/user-2.json.gz.enc'
    elif defect == 'size':
        account['archive_bytes'] = True
    elif defect == 'digest':
        account['archive_sha256'] = '0' * 64
    elif defect == 'null':
        account['archive_sha256'] = None
    else:
        del account['archive_bytes']
    objects[key] = encrypt(manifest)
    with pytest.raises((ValueError, KeyError, InvalidToken)):
        verify_run(client, 'synthetic-private', key, secret)
    assert all(stream.closed for stream in streams)
    if defect in ('other-run', 'size', 'partial', 'null'):
        assert reads == [key]  # Validate all references before reading account files.


def test_manifest_path_and_wrong_encryption_key_are_rejected():
    secret, key, _, _, _, client, reads, _ = stored_run()
    with pytest.raises(ValueError):
        verify_run(client, 'synthetic-private', '../manifest.json.gz.enc', secret)
    assert not reads
    with pytest.raises(InvalidToken):
        verify_run(client, 'synthetic-private', key, Fernet.generate_key())
