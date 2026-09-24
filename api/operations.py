"""Private operational status and authenticated daily recovery snapshots."""
import hmac
import gzip
import json
import os
from datetime import timedelta
from fastapi.encoders import jsonable_encoder
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, text
from .database import IS_EPHEMERAL_VERCEL_SQLITE, engine, get_db
from .index import current_user, admin_user
from .models import User, RecoveryPoint, utc_now
from .reliability_models import ServiceEvent, RateBucket
from .data_safety import save_recovery

router=APIRouter()


def external_backup_ready():
    return all(os.getenv(key) for key in ('BACKUP_S3_BUCKET', 'BACKUP_S3_REGION',
                                           'BACKUP_S3_ACCESS_KEY_ID', 'BACKUP_S3_SECRET_ACCESS_KEY',
                                           'BACKUP_ENCRYPTION_KEY'))


def external_snapshots(db):
    if not external_backup_ready():
        return 0
    import boto3
    from cryptography.fernet import Fernet
    from .index import export_backup
    cipher = Fernet(os.environ['BACKUP_ENCRYPTION_KEY'].encode())
    client = boto3.client('s3', region_name=os.environ['BACKUP_S3_REGION'],
                          endpoint_url=os.getenv('BACKUP_S3_ENDPOINT_URL') or None,
                          aws_access_key_id=os.environ['BACKUP_S3_ACCESS_KEY_ID'],
                          aws_secret_access_key=os.environ['BACKUP_S3_SECRET_ACCESS_KEY'])
    day = utc_now().date().isoformat()
    count = 0
    for user in db.query(User).filter_by(active=True).all():
        data = json.dumps(jsonable_encoder(export_backup(user, db))).encode()
        payload = cipher.encrypt(gzip.compress(data))
        upload = {'Bucket': os.environ['BACKUP_S3_BUCKET'],
                  'Key': f'budgetly/{day}/user-{user.id}.json.gz.enc', 'Body': payload,
                  'ContentType': 'application/octet-stream'}
        if not os.getenv('BACKUP_S3_ENDPOINT_URL'):
            upload['ServerSideEncryption'] = 'AES256'
        client.put_object(**upload)
        count += 1
    db.add(ServiceEvent(area='external-backup', status=200))
    db.commit()
    return count


def daily_snapshots(db):
    total=0
    for user in db.query(User).filter_by(active=True).all():
        db.query(User).filter_by(id=user.id).with_for_update().first()
        exists=db.query(RecoveryPoint).filter_by(user_id=user.id,reason='Daily recovery snapshot').filter(RecoveryPoint.created_at>=utc_now().replace(hour=0,minute=0,second=0,microsecond=0)).first()
        if not exists:
            save_recovery(db,user,user,'Daily recovery snapshot');total+=1
    db.query(RecoveryPoint).filter(RecoveryPoint.reason=='Daily recovery snapshot',RecoveryPoint.created_at<utc_now()-timedelta(days=30)).delete(synchronize_session=False)
    db.query(ServiceEvent).filter(ServiceEvent.created_at<utc_now()-timedelta(days=30)).delete()
    db.query(RateBucket).filter(RateBucket.started<utc_now()-timedelta(days=2)).delete()
    db.add(ServiceEvent(area='daily-recovery',status=200));db.commit()
    external = 0
    if external_backup_ready():
        try:
            external = external_snapshots(db)
        except Exception:
            import logging
            logging.getLogger('flowbudget').exception('External backup failed')
            db.rollback()
            db.add(ServiceEvent(area='external-backup', status=500))
            db.commit()
            raise HTTPException(503, 'External backup failed; investigate the backup destination')
    return {'ok':True,'snapshots_created':total,'external_backups_created':external}


def cron_auth(request):
    secret=os.getenv('CRON_SECRET','')
    if not secret or not hmac.compare_digest(request.headers.get('Authorization',''),'Bearer '+secret):
        raise HTTPException(401,'Unauthorized')


@router.get('/api/maintenance/daily')
def maintenance(request:Request,db=Depends(get_db)):
    cron_auth(request)
    return daily_snapshots(db)


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
    return {'database':'connected','database_engine':engine.dialect.name,'persistent_storage':not IS_EPHEMERAL_VERCEL_SQLITE,'email_configured':smtp_status().get('configured',False),'daily_job_configured':bool(os.getenv('CRON_SECRET')),'external_backup_configured':external_backup_ready(),'last_daily_backup':backup.created_at.isoformat()+'Z' if backup else None,'last_external_backup':external.created_at.isoformat()+'Z' if external else None,'events':[{'id':r.id,'area':r.area,'status':r.status,'duration_ms':r.duration_ms,'created_at':r.created_at.isoformat()+'Z'} for r in events]}
