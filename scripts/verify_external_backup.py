"""Verify an encrypted off-site backup and optionally extract its JSON for a test restore."""
import argparse
import gzip
import json
import os
from pathlib import Path

from cryptography.fernet import Fernet


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
        encrypted = args.file.read_bytes()
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
        encrypted = client.get_object(Bucket=os.environ['BACKUP_S3_BUCKET'], Key=args.key)['Body'].read()
    data = json.loads(gzip.decompress(Fernet(secret.encode()).decrypt(encrypted)))
    required = ('wallets', 'categories', 'transactions', 'budgets', 'goals', 'debts', 'settings')
    if data.get('version') != 1 or any(name not in data for name in required):
        raise ValueError('This is not a supported Budgetly workspace backup')
    print('Backup verified:', ', '.join(f'{name}={len(data[name])}' for name in required if isinstance(data[name], list)))
    if args.output:
        if args.output.exists():
            raise FileExistsError('Output already exists; choose a new path')
        args.output.write_text(json.dumps(data, indent=2), encoding='utf-8')
        print('Restored JSON written to:', args.output)


if __name__ == '__main__':
    main()
