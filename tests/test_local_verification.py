"""Keep API imports in a child process so inherited database settings cannot win."""
import gzip
import io
import json
import os
from pathlib import Path
import subprocess
import sys

from cryptography.fernet import Fernet, InvalidToken
import pytest

from scripts.verify_external_backup import decode_backup
from scripts import verify_external_backup as verifier

ROOT = Path(__file__).resolve().parents[1]


def archive(data, key):
    return Fernet(key).encrypt(gzip.compress(json.dumps(data).encode()))


def fixture():
    return dict(version=1, settings={}, **{name: [] for name in
                ('wallets', 'categories', 'transactions', 'budgets', 'goals', 'debts')})


@pytest.mark.parametrize('data', [[], {'version': 1}, {**fixture(), 'wallets': {}},
                                  {**fixture(), 'settings': []}, {**fixture(), 'transactions': [7]},
                                  {**fixture(), 'version': 2}])
def test_verifier_rejects_invalid_structure(data):
    key = Fernet.generate_key()
    with pytest.raises(ValueError):
        decode_backup(archive(data, key), key)


def test_verifier_authenticates_archive():
    key = Fernet.generate_key()
    encrypted = archive(fixture(), key)
    assert decode_backup(encrypted, key) == fixture()
    with pytest.raises(InvalidToken):
        decode_backup(encrypted, Fernet.generate_key())
    with pytest.raises(InvalidToken):
        decode_backup(encrypted[:-10] + b'corrupted!', key)


def test_archive_limit_checked_before_decryption(monkeypatch):
    monkeypatch.setattr(verifier, 'MAX_ARCHIVE_BYTES', 8)
    with pytest.raises(ValueError, match='archive byte limit'):
        decode_backup(b'x' * 9, b'invalid-key')


@pytest.mark.parametrize('extra', [0, 1])
def test_decompressed_size_boundary(monkeypatch, extra):
    key = Fernet.generate_key()
    raw = json.dumps(fixture()).encode()
    monkeypatch.setattr(verifier, 'MAX_JSON_BYTES', len(raw))
    encrypted = Fernet(key).encrypt(gzip.compress(raw + b' ' * extra))
    if extra:
        with pytest.raises(ValueError, match='JSON byte limit'):
            decode_backup(encrypted, key)
    else:
        assert decode_backup(encrypted, key) == fixture()


@pytest.mark.parametrize('concatenated', [False, True])
def test_compression_bomb_and_combined_members_are_bounded(monkeypatch, concatenated):
    key = Fernet.generate_key()
    monkeypatch.setattr(verifier, 'MAX_JSON_BYTES', 1024)
    compressed = (gzip.compress(b' ' * 600) * 2 if concatenated
                  else gzip.compress(b' ' * 1_000_000))
    with pytest.raises(ValueError, match='JSON byte limit'):
        decode_backup(Fernet(key).encrypt(compressed), key)


@pytest.mark.parametrize('corruption', ['truncated', 'checksum'])
def test_gzip_integrity_is_checked(monkeypatch, corruption):
    key = Fernet.generate_key()
    raw = json.dumps(fixture()).encode()
    monkeypatch.setattr(verifier, 'MAX_JSON_BYTES', len(raw))
    compressed = gzip.compress(raw)
    compressed = compressed[:-1] if corruption == 'truncated' else compressed[:-8] + b'\x00' * 8
    with pytest.raises((EOFError, gzip.BadGzipFile)):
        decode_backup(Fernet(key).encrypt(compressed), key)


@pytest.mark.parametrize('extra', [0, 1])
def test_archive_stream_boundary_and_short_reads(monkeypatch, extra):
    monkeypatch.setattr(verifier, 'MAX_ARCHIVE_BYTES', 8)
    class ShortStream(io.BytesIO):
        def read(self, size=-1):
            assert 0 < size <= 9
            return super().read(min(size, 2))
    stream = ShortStream(b'x' * (8 + extra))
    if extra:
        with pytest.raises(ValueError, match='archive byte limit'):
            verifier.read_archive(stream)
        assert stream.tell() == 9
    else:
        assert verifier.read_archive(stream) == b'x' * 8


@pytest.mark.parametrize('source', ['file', 's3'])
def test_cli_bounds_input_and_closes_stream(monkeypatch, tmp_path, source):
    monkeypatch.setattr(verifier, 'MAX_ARCHIVE_BYTES', 8)
    monkeypatch.setenv('BACKUP_ENCRYPTION_KEY', Fernet.generate_key().decode())
    output = tmp_path / 'must-not-exist.json'
    if source == 'file':
        archive_file = tmp_path / 'oversized.enc'
        archive_file.write_bytes(b'x' * 9)
        arguments = ['--file', str(archive_file)]
        body = None
    else:
        import boto3
        body = io.BytesIO(b'x' * 9)
        class Client:
            def get_object(self, **kwargs):
                return {'Body': body}
        monkeypatch.setattr(boto3, 'client', lambda *args, **kwargs: Client())
        for name in ('BUCKET', 'REGION', 'ACCESS_KEY_ID', 'SECRET_ACCESS_KEY'):
            monkeypatch.setenv('BACKUP_S3_' + name, 'synthetic')
        arguments = ['--key', 'synthetic.enc']
    monkeypatch.setattr(sys, 'argv', ['verify_external_backup', *arguments, '--output', str(output)])
    with pytest.raises(ValueError, match='archive byte limit'):
        verifier.main()
    assert not output.exists()
    if body is not None:
        assert body.closed


def test_local_drill_ignores_inherited_services():
    environment = {**os.environ, 'FLOWBUDGET_DATABASE_URL': 'postgresql://invalid.example.test/never',
                   'BACKUP_S3_BUCKET': 'never-contact', 'VERCEL': '1',
                   'ADMIN_INITIAL_EMAIL': 'real-data-must-not-be-used@example.test'}
    result = subprocess.run([sys.executable, '-m', 'scripts.verify_local', '--requests', '6',
                             '--workers', '2'], cwd=ROOT, env=environment,
                            capture_output=True, text=True, timeout=120)
    assert result.returncode == 0, result.stderr
    evidence = json.loads(result.stdout)
    assert evidence['passed']
    assert evidence['load']['errors'] == 0
    assert 'restored_balance' in evidence['checks']
    assert 'tenant_wallet_isolation' in evidence['checks']


@pytest.mark.parametrize('arguments', [['--requests', '0'], ['--workers', '17']])
def test_load_bounds(arguments):
    result = subprocess.run([sys.executable, '-m', 'scripts.verify_local', *arguments],
                            cwd=ROOT, capture_output=True, text=True, timeout=20)
    assert result.returncode == 2


def test_network_guard():
    from scripts.verify_local import deny_network
    with pytest.raises(RuntimeError, match='Outbound sockets'):
        deny_network(None, ('127.0.0.1', 8000))


def test_output_is_never_overwritten(tmp_path):
    output = tmp_path / 'evidence.json'
    output.write_text('existing evidence', encoding='utf-8')
    result = subprocess.run([sys.executable, '-m', 'scripts.verify_local', '--output', str(output)],
                            cwd=ROOT, capture_output=True, text=True, timeout=20)
    assert result.returncode == 2
    assert output.read_text(encoding='utf-8') == 'existing evidence'
