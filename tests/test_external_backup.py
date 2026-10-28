import gzip
import hashlib
import json
import io

import boto3
import pytest
from cryptography.fernet import Fernet
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from api.app import app  # noqa: F401 - registers all tables
from api.database import Base
from api.models import User
from api.operations import external_backup_ready, external_snapshots
from api.reliability_models import ServiceEvent


@pytest.mark.parametrize('custom_endpoint', [False, True])
def test_external_backup_is_encrypted_and_reports_success_only_after_upload(monkeypatch, custom_endpoint):
    monkeypatch.setenv('BACKUP_S3_BUCKET', 'isolated-test')
    monkeypatch.setenv('BACKUP_S3_REGION', 'us-east-1')
    monkeypatch.setenv('BACKUP_S3_ACCESS_KEY_ID', 'local-test')
    monkeypatch.setenv('BACKUP_S3_SECRET_ACCESS_KEY', 'local-test')
    if custom_endpoint:
        monkeypatch.setenv('BACKUP_S3_ENDPOINT_URL', 'https://storage.example.test')
    else:
        monkeypatch.delenv('BACKUP_S3_ENDPOINT_URL', raising=False)
    key = Fernet.generate_key()
    monkeypatch.setenv('BACKUP_ENCRYPTION_KEY', key.decode())
    written = []

    class Client:
        def put_object(self, **kwargs):
            written.append(kwargs)
        def get_object(self, **kwargs):
            return {'Body': io.BytesIO(next(row['Body'] for row in written if row['Key'] == kwargs['Key']))}

    monkeypatch.setattr(boto3, 'client', lambda *args, **kwargs: Client())
    engine = create_engine('sqlite://')
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        db.add(User(username='Owner', email='owner@backup.test', password_hash='unused'))
        db.commit()
        assert external_backup_ready()
        assert external_snapshots(db) == 1
        assert written[0]['Bucket'] == 'isolated-test'
        assert ('ServerSideEncryption' in written[0]) is not custom_endpoint
        decoded = json.loads(gzip.decompress(Fernet(key).decrypt(written[0]['Body'])))
        assert decoded['version'] == 1
        assert 'password_hash' not in decoded
        manifest = json.loads(gzip.decompress(Fernet(key).decrypt(written[1]['Body'])))
        assert manifest['kind'] == 'budgetly-account-recovery-manifest'
        assert manifest['accounts'][0]['archive_key'] == written[0]['Key']
        assert manifest['accounts'][0]['email'] == 'owner@backup.test'
        assert manifest['accounts'][0]['archive_bytes'] == len(written[0]['Body'])
        assert manifest['accounts'][0]['archive_sha256'] == hashlib.sha256(written[0]['Body']).hexdigest()
        assert 'password_hash' not in manifest['accounts'][0]
        assert 'owner@backup.test' not in written[1]['Body'].decode()
        assert db.query(ServiceEvent).filter_by(area='external-backup', status=200).count() == 1
        assert external_snapshots(db) == 1
        assert written[2]['Key'] != written[0]['Key']
        assert written[3]['Key'] != written[1]['Key']

        class InterruptedClient:
            def put_object(self, **kwargs):
                if kwargs['Key'].endswith('/manifest.json.gz.enc'):
                    raise RuntimeError('Synthetic interrupted manifest upload')

        monkeypatch.setattr(boto3, 'client', lambda *args, **kwargs: InterruptedClient())
        with pytest.raises(RuntimeError, match='Synthetic interrupted'):
            external_snapshots(db)
        db.rollback()
        assert db.query(ServiceEvent).filter_by(area='external-backup', status=200).count() == 2
        class CorruptedReadClient(Client):
            def get_object(self, **kwargs):
                return {'Body': io.BytesIO(b'corrupted read-back')}
        monkeypatch.setattr(boto3, 'client', lambda *args, **kwargs: CorruptedReadClient())
        with pytest.raises(ValueError, match='read-back'):
            external_snapshots(db)
        db.rollback()
        assert db.query(ServiceEvent).filter_by(area='external-backup', status=200).count() == 2
    engine.dispose()
