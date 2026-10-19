"""Verify an encrypted off-site backup and optionally extract its JSON for a test restore."""
import argparse
from contextlib import closing
import gzip
import io
import json
import os
from pathlib import Path

from cryptography.fernet import Fernet

MAX_ARCHIVE_BYTES = 40_000_000
MAX_JSON_BYTES = 25_000_000


def read_archive(stream):
    """Bound storage reads even when a stream returns short chunks."""
    data = bytearray()
    while len(data) <= MAX_ARCHIVE_BYTES:
        chunk = stream.read(min(64 * 1024, MAX_ARCHIVE_BYTES + 1 - len(data)))
        if not chunk:
            return bytes(data)
        data.extend(chunk)
    raise ValueError('Encrypted backup exceeds the archive byte limit')


def decode_backup(encrypted, secret):
    """Authenticate and validate an archive without reading environment or storage."""
    if len(encrypted) > MAX_ARCHIVE_BYTES:
        raise ValueError('Encrypted backup exceeds the archive byte limit')
    compressed = Fernet(secret).decrypt(encrypted)
    # GzipFile also checks trailers and counts concatenated members in this budget.
    with gzip.GzipFile(fileobj=io.BytesIO(compressed)) as archive:
        raw = archive.read(MAX_JSON_BYTES + 1)
    if len(raw) > MAX_JSON_BYTES:
        raise ValueError('Decompressed backup exceeds the JSON byte limit')
    data = json.loads(raw)
    if isinstance(data, dict) and data.get('kind') == 'budgetly-account-recovery-manifest':
        accounts = data.get('accounts')
        if data.get('version') != 1 or not isinstance(accounts, list) or any(
            not isinstance(row, dict) or type(row.get('id')) is not int or row['id'] <= 0 or
            not isinstance(row.get('email'), str) or '@' not in row['email'] or
            not isinstance(row.get('username'), str) or row.get('role') not in {'admin', 'user'} or
            not isinstance(row.get('archive_key'), str) or
            not row['archive_key'].startswith('budgetly/') or
            not row['archive_key'].endswith(f"/user-{row['id']}.json.gz.enc")
            for row in accounts
        ) or len({row['id'] for row in accounts}) != len(accounts) or len({row['email'] for row in accounts}) != len(accounts):
            raise ValueError('Invalid account recovery manifest')
        return data
    collections = ('wallets', 'categories', 'transactions', 'budgets', 'goals', 'debts')
    if (not isinstance(data, dict) or data.get('version') != 1
            or any(not isinstance(data.get(name), list) for name in collections)
            or not isinstance(data.get('settings'), dict)
            or any(not isinstance(row, dict) for name in collections for row in data[name])):
        raise ValueError('This is not a supported Budgetly workspace backup')
    return data


def main():
    parser = argparse.ArgumentParser(description='Verify a Budgetly external backup')
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--file', type=Path, help='Downloaded encrypted backup file')
    source.add_argument('--key', help='S3 object key under the configured bucket')
    parser.add_argument('--output', type=Path, help='Write the restored JSON to this local file')
    args = parser.parse_args()
    secret = os.environ.get('BACKUP_ENCRYPTION_KEY')
    if not secret:
        parser.error('BACKUP_ENCRYPTION_KEY is required')
    if args.file:
        with args.file.open('rb') as source_file:
            encrypted = read_archive(source_file)
    else:
        import boto3
        required = ('BACKUP_S3_BUCKET', 'BACKUP_S3_REGION', 'BACKUP_S3_ACCESS_KEY_ID', 'BACKUP_S3_SECRET_ACCESS_KEY')
        missing = [name for name in required if not os.environ.get(name)]
        if missing:
            parser.error('Missing: ' + ', '.join(missing))
        client = boto3.client('s3', region_name=os.environ['BACKUP_S3_REGION'],
                              endpoint_url=os.getenv('BACKUP_S3_ENDPOINT_URL') or None,
                              aws_access_key_id=os.environ['BACKUP_S3_ACCESS_KEY_ID'],
                              aws_secret_access_key=os.environ['BACKUP_S3_SECRET_ACCESS_KEY'])
        with closing(client.get_object(Bucket=os.environ['BACKUP_S3_BUCKET'], Key=args.key)['Body']) as body:
            encrypted = read_archive(body)
    data = decode_backup(encrypted, secret.encode())
    if data.get('kind') == 'budgetly-account-recovery-manifest':
        print('Recovery manifest verified: accounts=' + str(len(data['accounts'])))
        if args.output:
            with args.output.open('x', encoding='utf-8') as output:
                json.dump(data, output, indent=2)
        return
    required = ('wallets', 'categories', 'transactions', 'budgets', 'goals', 'debts', 'settings')
    if data.get('version') != 1 or any(name not in data for name in required):
        raise ValueError('This is not a supported Budgetly workspace backup')
    print('Backup verified:', ', '.join(f'{name}={len(data[name])}' for name in required if isinstance(data[name], list)))
    if args.output:
        with args.output.open('x', encoding='utf-8') as output:
            json.dump(data, output, indent=2)
        print('Restored JSON written to:', args.output)


if __name__ == '__main__':
    main()
