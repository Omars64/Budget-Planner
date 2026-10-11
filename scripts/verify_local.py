"""Synthetic, socket-free API load, security and recovery evidence. Run as a module."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import gzip
import json
import math
import os
from pathlib import Path
import secrets
import socket
import sys
import tempfile
import threading
import time


def isolated_environment(directory):
    # Clear inherited service credentials and every database alias before API import.
    retained = {k: v for k, v in os.environ.items() if k.upper() in {
        'PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'COMSPEC', 'PATHEXT',
    }}
    os.environ.clear()
    os.environ.update(retained)
    os.environ.update(
        FLOWBUDGET_DATABASE_URL=f'sqlite:///{Path(directory).as_posix()}/synthetic.db',
        APP_SECRET=secrets.token_urlsafe(48), BUDGETLY_SEED_DEMO='false',
        ADMIN_INITIAL_EMAIL='owner@example.test', ADMIN_INITIAL_USERNAME='Synthetic',
        ADMIN_INITIAL_PASSWORD='SyntheticPassword123!',
    )


_socket_context = threading.local()


def deny_network(*args, **kwargs):
    if getattr(_socket_context, 'internal_pair', False):
        return _socket_context.connect(*args, **kwargs)
    raise RuntimeError('Outbound sockets are disabled during local verification')


def run(mode, requests=40, workers=4):
    if any(name == 'api' or name.startswith('api.') for name in sys.modules):
        raise RuntimeError('Run verification in a fresh Python process before importing api')
    from cryptography.fernet import Fernet
    from fastapi.testclient import TestClient
    from scripts.verify_external_backup import decode_backup

    scratch = Path(__file__).resolve().parents[1] / '.verification'
    scratch.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='budgetly-verification-', dir=scratch) as directory:
        isolated_environment(directory)
        original_connect, original_connect_ex = socket.socket.connect, socket.socket.connect_ex
        original_pair = socket.socketpair
        def internal_pair(*args, **kwargs):
            # Windows implements asyncio's internal socketpair via a loopback connect.
            _socket_context.internal_pair = True
            _socket_context.connect = original_connect
            try:
                return original_pair(*args, **kwargs)
            finally:
                _socket_context.internal_pair = False
        socket.socketpair = internal_pair
        socket.socket.connect = socket.socket.connect_ex = deny_network
        engine = None
        try:
            from api.app import app
            from api.database import engine
            checks = []

            def check(name, condition):
                if not condition:
                    raise RuntimeError(f'Verification failed: {name}')
                checks.append(name)

            with TestClient(app) as client:
                def call(method, path, status=200, **kwargs):
                    response = client.request(method, path, **kwargs)
                    if response.status_code != status:
                        raise RuntimeError(f'{method} {path}: expected {status}, got {response.status_code}')
                    return response.json() if response.content else None

                login = call('POST', '/api/auth/login', json={
                    'email': 'owner@example.test', 'password': 'SyntheticPassword123!'})
                headers = {'Authorization': 'Bearer ' + login['token']}
                wallet = call('POST', '/api/wallets', 201, headers=headers,
                              json={'name': 'Synthetic wallet', 'type': 'cash', 'initial_balance': 100})
                call('POST', '/api/transactions', 201, headers=headers, json={
                    'wallet_id': wallet['id'], 'type': 'expense', 'amount': 7.125,
                    'description': 'Synthetic fixture', 'date': '2026-01-15T12:00:00'})
                if mode in {'security', 'all'}:
                    call('GET', '/api/backup', 401)
                    call('GET', '/api/wallets', 401, headers={'Authorization': 'Bearer invalid'})
                    call('POST', '/api/admin/users', 201, headers=headers, json={
                        'username': 'Other synthetic', 'email': 'other@example.test',
                        'password': 'SyntheticPassword123!', 'role': 'user', 'active': True})
                    other = call('POST', '/api/auth/login', json={
                        'email': 'other@example.test', 'password': 'SyntheticPassword123!'})
                    other_headers = {'Authorization': 'Bearer ' + other['token']}
                    call('GET', '/api/admin/users', 403, headers=other_headers)
                    check('tenant_wallet_isolation', wallet['id'] not in {
                        row['id'] for row in call('GET', '/api/wallets', headers=other_headers)})
                    call('DELETE', f"/api/wallets/{wallet['id']}", 404, headers=other_headers)
                    from api.database import SessionLocal
                    from api.reliability_models import AccountSession
                    with SessionLocal() as db:
                        db.query(AccountSession).update({'verified_at': None})
                        db.commit()
                    call('POST', '/api/backup/restore', 428, headers=headers, json={'version': 1})
                    check('authentication_authorization_confirmation', True)
                if mode in {'recovery', 'all'}:
                    backup = call('GET', '/api/backup', headers=headers)
                    key = Fernet.generate_key()
                    encrypted = Fernet(key).encrypt(gzip.compress(json.dumps(backup).encode()))
                    decoded = decode_backup(encrypted, key)
                    check('encrypted_archive_roundtrip', decoded == backup)
                    call('POST', '/api/account/confirm', headers=headers,
                         json={'password': 'SyntheticPassword123!'})
                    call('POST', '/api/backup/restore', 400, headers=headers, json={'version': 999})
                    check('invalid_restore_preserves_data', call('GET', '/api/backup', headers=headers)['transactions'] == backup['transactions'])
                    call('DELETE', f"/api/wallets/{wallet['id']}?delete_transactions=true", 204, headers=headers)
                    call('POST', '/api/backup/restore', headers=headers, json=decoded)
                    restored = call('GET', '/api/backup', headers=headers)
                    check('restored_transaction_values', [(t['description'], t['amount'], t['type'], t['date']) for t in restored['transactions']] ==
                          [(t['description'], t['amount'], t['type'], t['date']) for t in backup['transactions']])
                    restored_wallet = next(w for w in call('GET', '/api/wallets', headers=headers) if w['name'] == 'Synthetic wallet')
                    check('restored_balance', math.isclose(restored_wallet['balance'], 92.875, abs_tol=0.0001))
                metrics = None
                if mode in {'load', 'all'}:
                    paths = ('/api/wallets', '/api/transactions', '/api/dashboard?month=2026-01')
                    def read(index):
                        start = time.perf_counter()
                        call('GET', paths[index % len(paths)], headers=headers)
                        return (time.perf_counter() - start) * 1000
                    start = time.perf_counter()
                    with ThreadPoolExecutor(max_workers=workers) as pool:
                        durations = sorted(pool.map(read, range(requests)))
                    elapsed = time.perf_counter() - start
                    metrics = {'requests': requests, 'workers': workers, 'errors': 0,
                               'elapsed_seconds': round(elapsed, 3),
                               'requests_per_second': round(requests / elapsed, 2),
                               'p50_ms': round(durations[math.ceil(requests * .5) - 1], 3),
                               'p95_ms': round(durations[math.ceil(requests * .95) - 1], 3)}
                    check('concurrent_api_reads', True)
                return {'schema_version': 1, 'mode': mode, 'passed': True,
                        'isolation': 'temporary SQLite / in-process ASGI / outbound sockets denied',
                        'checks': checks, 'load': metrics}
        finally:
            if engine is not None:
                engine.dispose()
            socket.socket.connect, socket.socket.connect_ex = original_connect, original_connect_ex
            socket.socketpair = original_pair


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode', choices=('load', 'security', 'recovery', 'all'), default='all')
    parser.add_argument('--requests', type=int, default=40)
    parser.add_argument('--workers', type=int, default=4)
    parser.add_argument('--output', type=Path, help='New JSON evidence file; never overwritten')
    args = parser.parse_args()
    if not 1 <= args.requests <= 2000 or not 1 <= args.workers <= 16:
        parser.error('requests must be 1..2000 and workers 1..16')
    if args.output and args.output.exists():
        parser.error('Output already exists')
    evidence = run(args.mode, args.requests, args.workers)
    if args.output:
        with args.output.open('x', encoding='utf-8') as output:
            json.dump(evidence, output, indent=2)
    print(json.dumps(evidence, indent=2))


if __name__ == '__main__':
    main()
