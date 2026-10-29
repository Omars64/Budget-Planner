"""Private operational status and authenticated daily recovery snapshots."""
import hmac
import hashlib
import gzip
import json
import logging
import os
import secrets
from contextlib import closing, ExitStack
from tempfile import TemporaryFile
from datetime import datetime, timedelta, timezone
from fastapi.encoders import jsonable_encoder
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, text
from .database import IS_EPHEMERAL_VERCEL_SQLITE, engine, get_db
from .index import current_user, admin_user
from .models import User, RecoveryPoint, utc_now
from .reliability_models import ServiceEvent, RateBucket
from .data_safety import save_recovery
from .monitoring import job_status

router=APIRouter()
BACKUP_KEYS = ('BACKUP_S3_BUCKET', 'BACKUP_S3_REGION', 'BACKUP_S3_ACCESS_KEY_ID',
               'BACKUP_S3_SECRET_ACCESS_KEY', 'BACKUP_ENCRYPTION_KEY')


def external_backup_ready():
    return all(os.getenv(key) for key in BACKUP_KEYS)


def external_snapshots(db, *, force=True):
    if not external_backup_ready():
        return 0
    import boto3
    from botocore.config import Config
    from cryptography.fernet import Fernet
    from .index import export_backup
    from . import backup_efficiency as efficiency
    settings = efficiency.policy()
    now = utc_now()
    if not force:
        last = db.query(ServiceEvent).filter_by(area='external-backup').order_by(
            ServiceEvent.created_at.desc(), ServiceEvent.id.desc()).first()
        # A failure never suppresses a retry; manual backups always run.
        # Daily cron start time varies by seconds. Allow five minutes of jitter so
        # a 24-hour interval cannot accidentally become a 48-hour recovery gap.
        spacing = timedelta(hours=settings.get('backup_interval_hours', 24)) - timedelta(minutes=5)
        if last and last.status == 200 and now - spacing < last.created_at <= now:
            efficiency.metric('backup_interval_skips')
            return 0
    cipher = Fernet(os.environ['BACKUP_ENCRYPTION_KEY'].encode())
    client = boto3.client('s3', region_name=os.environ['BACKUP_S3_REGION'],
                          endpoint_url=os.getenv('BACKUP_S3_ENDPOINT_URL') or None,
                          aws_access_key_id=os.environ['BACKUP_S3_ACCESS_KEY_ID'],
                          aws_secret_access_key=os.environ['BACKUP_S3_SECRET_ACCESS_KEY'],
                          config=Config(connect_timeout=5, read_timeout=20,
                                        retries={'max_attempts': 2, 'mode': 'standard'}))
    day = utc_now().date().isoformat()
    prefix = f'budgetly/{day}/{secrets.token_hex(16)}'
    count = 0
    deduplicate = not force and settings.get('backup_skip_unchanged', False)
    digest = hashlib.sha256()
    staged = []
    identities = []
    with ExitStack() as files:
        for user in db.query(User).filter_by(active=True).order_by(User.id).all():
            exported = jsonable_encoder(export_backup(user, db))
            identity = {'id': user.id, 'email': user.email, 'username': user.username, 'role': user.role}
            efficiency.update_digest(digest, identity, exported)
            data = json.dumps(exported).encode()
            payload = cipher.encrypt(gzip.compress(data))
            upload = {'Bucket': os.environ['BACKUP_S3_BUCKET'],
                      'Key': f'{prefix}/user-{user.id}.json.gz.enc', 'Body': payload,
                      'ContentType': 'application/octet-stream'}
            if not os.getenv('BACKUP_S3_ENDPOINT_URL'):
                upload['ServerSideEncryption'] = 'AES256'
            if deduplicate:
                # Stage ciphertext only, not plaintext; bound resident memory per account.
                staged_file = files.enter_context(TemporaryFile())
                staged_file.write(payload)
                staged.append(({key: value for key, value in upload.items() if key != 'Body'}, staged_file))
            else:
                client.put_object(**upload)
            identities.append({**identity, 'archive_key': upload['Key'],
                               'archive_bytes': len(payload),
                               'archive_sha256': hashlib.sha256(payload).hexdigest()})
            count += 1
        if deduplicate:
            previous = efficiency.read_state(client, cipher, now)
            if previous and hmac.compare_digest(previous['digest'], digest.hexdigest()):
                try:
                    matches = efficiency.verify_existing(client, cipher, previous['manifest_key'], digest.hexdigest(), count)
                except Exception:
                    matches = False
                if matches:
                    db.add(ServiceEvent(area='external-backup', status=200))
                    db.commit()
                    efficiency.metric('backup_unchanged_runs')
                    return 0
            for upload, staged_file in staged:
                staged_file.seek(0)
                client.put_object(**upload, Body=staged_file.read())
    manifest = {'version': 1, 'kind': 'budgetly-account-recovery-manifest',
                'exported_at': utc_now().isoformat() + 'Z', 'accounts': identities}
    metadata = {'Bucket': os.environ['BACKUP_S3_BUCKET'],
                'Key': f'{prefix}/manifest.json.gz.enc',
                'Body': cipher.encrypt(gzip.compress(json.dumps(manifest).encode())),
                'ContentType': 'application/octet-stream'}
    if not os.getenv('BACKUP_S3_ENDPOINT_URL'):
        metadata['ServerSideEncryption'] = 'AES256'
    client.put_object(**metadata)
    # A completed upload is not yet evidence that recovery can read the bytes.
    # Verify the commit marker and every encrypted object before recording success.
    # Digests refer to bytes just encrypted here; no plaintext or keys are logged.
    for key, length, expected_digest in [
        (row['archive_key'], row['archive_bytes'], row['archive_sha256']) for row in identities
    ] + [(metadata['Key'], len(metadata['Body']), hashlib.sha256(metadata['Body']).hexdigest())]:
        with closing(client.get_object(Bucket=os.environ['BACKUP_S3_BUCKET'], Key=key)['Body']) as body:
            remaining, actual = length, hashlib.sha256()
            while remaining:
                chunk = body.read(min(64 * 1024, remaining))
                if not chunk:
                    raise ValueError('External backup read-back was incomplete')
                actual.update(chunk)
                remaining -= len(chunk)
            if body.read(1) or not hmac.compare_digest(actual.hexdigest(), expected_digest):
                raise ValueError('External backup read-back integrity failed')
    db.add(ServiceEvent(area='external-backup', status=200))
    db.commit()
    if settings.get('backup_skip_unchanged', False):
        efficiency.write_state(client, cipher, digest.hexdigest(), metadata['Key'], now)
    efficiency.metric('backup_upload_runs')
    return count


def daily_snapshots(db, *, force_external=True):
    total=0
    for user in db.query(User).filter_by(active=True).all():
        db.query(User).filter_by(id=user.id).with_for_update().first()
        exists=db.query(RecoveryPoint).filter_by(user_id=user.id,reason='Daily recovery snapshot').filter(RecoveryPoint.created_at>=utc_now().replace(hour=0,minute=0,second=0,microsecond=0)).first()
        if not exists:
            save_recovery(db,user,user,'Daily recovery snapshot');total+=1
    db.query(RecoveryPoint).filter(RecoveryPoint.reason=='Daily recovery snapshot',RecoveryPoint.created_at<utc_now()-timedelta(days=30)).delete(synchronize_session=False)
    db.query(ServiceEvent).filter(ServiceEvent.created_at<utc_now()-timedelta(days=30)).delete()
    db.query(RateBucket).filter(RateBucket.started<utc_now()-timedelta(days=2)).delete()
    from .google_auth import GoogleAuthState
    from .google_drive import GoogleDriveOAuthAttempt
    db.query(GoogleAuthState).filter(GoogleAuthState.expires_at<utc_now()).delete(synchronize_session=False)
    db.query(GoogleDriveOAuthAttempt).filter(GoogleDriveOAuthAttempt.expires_at<utc_now()).delete(synchronize_session=False)
    db.add(ServiceEvent(area='daily-recovery',status=200));db.commit()
    external = 0
    if external_backup_ready():
        try:
            external = external_snapshots(db, force=force_external)
        except Exception as error:
            import logging
            logging.getLogger('flowbudget').error('External backup failed: %s', type(error).__name__)
            db.rollback()
            db.add(ServiceEvent(area='external-backup', status=500))
            db.commit()
            raise HTTPException(503, 'External backup failed; investigate the backup destination')
    return {'ok':True,'snapshots_created':total,'external_backups_created':external,
            'external_backup_configured':external_backup_ready()}


def cron_auth(request):
    secret=os.getenv('CRON_SECRET','')
    if not secret or not hmac.compare_digest(request.headers.get('Authorization',''),'Bearer '+secret):
        raise HTTPException(401,'Unauthorized')


@router.get('/api/maintenance/daily')
def maintenance(request:Request,db=Depends(get_db)):
    cron_auth(request)
    from .provider_revocation import retry_due
    revocations = retry_due(db)
    from .planned import post_due
    posted = post_due(db)
    result = {**daily_snapshots(db, force_external=False), 'scheduled_transactions_posted': posted, 'provider_revocations': revocations}
    from .update_push import dispatch_updates
    try:
        result['update_push'] = dispatch_updates(db)
    except Exception:
        db.rollback()
        result['update_push'] = {'error': 'Update delivery failed; core maintenance completed.'}
    return result


@router.post('/api/maintenance/scheduled-transactions')
def scheduled_transactions(request: Request, db=Depends(get_db)):
    secret = os.getenv('SCHEDULE_RUNNER_SECRET', '')
    if not secret or not hmac.compare_digest(request.headers.get('Authorization', ''), 'Bearer ' + secret):
        raise HTTPException(401, 'Unauthorized')
    claim = getattr(request.state, 'resource_claim', None)
    coordinated = bool(claim and claim.get('action') == 'run')
    if coordinated:
        request.state.resource_scheduler_success = False
    from .planned import post_due
    from .models import PlannedTransaction
    from .timekeeping import now as ledger_now
    # Keep frequent execution separate from backups and push dispatch.
    from .monitoring import record_job
    posted = 0
    try:
        for _ in range(10):
            batch = post_due(db)
            posted += batch
            if not db.query(PlannedTransaction.id).filter(PlannedTransaction.status == 'scheduled', PlannedTransaction.due_at <= ledger_now()).first():
                break
        record_job(db, 'scheduler-heartbeat', 200)
    except Exception:
        db.rollback()
        record_job(db, 'scheduler-heartbeat', 503)
        raise HTTPException(503, 'Scheduled processing failed; previously posted entries remain protected against duplicates') from None
    if posted:
        db.add(ServiceEvent(area='scheduled-transactions', status=200))
        db.commit()
    from .update_push import dispatch_scheduled
    try:
        delivery = dispatch_scheduled(db)
    except Exception:
        db.rollback()
        record_job(db, 'scheduled-notification-delivery', 503)
        delivery = {'failed': True}
    from .upcoming_reminders import dispatch_upcoming
    try:
        upcoming_delivery = dispatch_upcoming(db)
        if upcoming_delivery.get('failed'):
            record_job(db, 'upcoming-reminder-delivery', 503)
    except Exception as error:
        db.rollback()
        record_job(db, 'upcoming-reminder-delivery', 503)
        logging.getLogger('flowbudget').warning('upcoming_reminder_failure stage=dispatcher type=%s', type(error).__name__)
        upcoming_delivery = {'failed': True}
    if coordinated:
        from .resource_schedule import next_scheduler_wake
        wake = next_scheduler_wake(db, datetime.now(timezone.utc))
        request.state.resource_next_epoch = wake.timestamp() if wake is not None else None
        request.state.resource_scheduler_success = not (delivery.get('failed') or upcoming_delivery.get('failed'))
    return {'ok': True, 'scheduled_transactions_posted': posted, 'notifications': delivery, 'upcoming_notifications': upcoming_delivery}


@router.post('/api/maintenance/updates')
@router.get('/api/maintenance/update-check')
def push_updates_now(request: Request, db=Depends(get_db)):
    cron_auth(request)
    from .update_push import dispatch_updates
    return dispatch_updates(db)


@router.post('/api/maintenance/release-updates')
def release_updates(request: Request, db=Depends(get_db)):
    secret = os.getenv('UPDATE_RELEASE_SECRET', '')
    if not secret or not hmac.compare_digest(request.headers.get('Authorization', ''), 'Bearer ' + secret):
        raise HTTPException(401, 'Unauthorized')
    from .account_security import limit
    limit(db, 'release-update-dispatch', maximum=12, seconds=300)
    from .update_push import dispatch_updates
    return dispatch_updates(db)


@router.post('/api/admin/operations/backup')
def backup_now(request:Request,user=Depends(admin_user),db=Depends(get_db)):
    from .account_security import confirmed
    confirmed(request,db,user)
    return daily_snapshots(db)


@router.get('/api/admin/operations')
def operations(user=Depends(admin_user),db=Depends(get_db)):
    from .email_service import smtp_status
    db.execute(text('SELECT 1'))
    events=db.query(ServiceEvent).order_by(ServiceEvent.id.desc()).limit(100).all()
    backup=db.query(ServiceEvent).filter_by(area='daily-recovery',status=200).order_by(ServiceEvent.id.desc()).first()
    external=db.query(ServiceEvent).filter_by(area='external-backup',status=200).order_by(ServiceEvent.id.desc()).first()
    return {'jobs':job_status(db),'database':'connected','database_engine':engine.dialect.name,'persistent_storage':not IS_EPHEMERAL_VERCEL_SQLITE,'email_configured':smtp_status().get('configured',False),'daily_job_configured':bool(os.getenv('CRON_SECRET')),'external_backup_configured':external_backup_ready(),
            'external_backup_missing':[key for key in BACKUP_KEYS if not os.getenv(key)],
            'last_daily_backup':backup.created_at.isoformat()+'Z' if backup else None,'last_external_backup':external.created_at.isoformat()+'Z' if external else None,'events':[{'id':r.id,'area':r.area,'status':r.status,'duration_ms':r.duration_ms,'created_at':r.created_at.isoformat()+'Z'} for r in events]}
