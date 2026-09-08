"""Private operational status and authenticated daily recovery snapshots."""
import hmac
import os
from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, text
from .database import get_db
from .index import current_user, admin_user
from .models import User, RecoveryPoint, utc_now
from .reliability_models import ServiceEvent, RateBucket
from .data_safety import save_recovery

router=APIRouter()


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
    db.add(ServiceEvent(area='daily-backup',status=200));db.commit()
    return {'ok':True,'snapshots_created':total}


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
    backup=db.query(ServiceEvent).filter_by(area='daily-backup',status=200).order_by(ServiceEvent.id.desc()).first()
    return {'database':'connected','email_configured':smtp_status().get('configured',False),'daily_job_configured':bool(os.getenv('CRON_SECRET')),'external_backup_configured':bool(os.getenv('BACKUP_ENCRYPTION_KEY')),'last_daily_backup':backup.created_at.isoformat()+'Z' if backup else None,'events':[{'id':r.id,'area':r.area,'status':r.status,'duration_ms':r.duration_ms,'created_at':r.created_at.isoformat()+'Z'} for r in events]}
