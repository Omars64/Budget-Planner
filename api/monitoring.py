"""Operational signals contain no account records, credentials or request bodies."""
from datetime import datetime, timedelta, timezone
import os
from . import resource_control
from .models import PlannedTransaction, utc_now
from .reliability_models import ServiceEvent
from .timekeeping import now as ledger_now


def record_job(db, area, status):
    row = db.query(ServiceEvent).filter_by(area=area).order_by(ServiceEvent.created_at.desc(), ServiceEvent.id.desc()).first()
    if row is None:
        row = ServiceEvent(area=area, status=status)
        db.add(row)
    row.status, row.created_at = status, utc_now()
    db.commit()


def job_status(db):
    result = {}
    now = utc_now()
    for name, area, secret, minutes in (
        ('scheduler', 'scheduler-heartbeat', 'SCHEDULE_RUNNER_SECRET', 5),
        ('daily_backup', 'daily-recovery', 'CRON_SECRET', 2160),
    ):
        row = db.query(ServiceEvent).filter_by(area=area).order_by(ServiceEvent.created_at.desc(), ServiceEvent.id.desc()).first()
        configured = bool(os.getenv(secret))
        fresh = bool(row and row.status == 200 and now - timedelta(minutes=minutes) <= row.created_at <= now)
        result[name] = {'configured': configured, 'healthy': fresh if configured else None,
                        'last_run': row.created_at.isoformat() + 'Z' if row else None}
    if result['scheduler']['configured'] and resource_control.configured():
        scheduler = result['scheduler']
        scheduler.update(healthy=False, last_run=None)
        try:
            state = resource_control.read_state()
            if state['coordination']['healthy']:
                status = state['status']
                tick = status.get('last_tick')
                failure = status.get('last_failure')
                success = status.get('last_success')
                now_epoch = now.replace(tzinfo=timezone.utc).timestamp()
                scheduler['healthy'] = bool(tick is not None and 0 <= now_epoch - tick <= 300 and
                    (failure is None or (success is not None and failure <= success)))
                last_run = status.get('last_run')
                if last_run is not None:
                    scheduler['last_run'] = datetime.fromtimestamp(last_run, timezone.utc).replace(tzinfo=None).isoformat() + 'Z'
        except Exception:
            scheduler.update(healthy=False, last_run=None)
    backup_keys = ('BACKUP_S3_BUCKET', 'BACKUP_S3_REGION', 'BACKUP_S3_ACCESS_KEY_ID',
                   'BACKUP_S3_SECRET_ACCESS_KEY', 'BACKUP_ENCRYPTION_KEY')
    configured = any(os.getenv(key) for key in backup_keys)
    complete = all(os.getenv(key) for key in backup_keys)
    external = db.query(ServiceEvent).filter_by(area='external-backup').order_by(
        ServiceEvent.created_at.desc(), ServiceEvent.id.desc()).first()
    healthy = bool(complete and external and external.status == 200 and
                   now - timedelta(minutes=2160) <= external.created_at <= now)
    result['external_backup'] = {'configured': configured, 'healthy': healthy if configured else None,
                                'last_run': external.created_at.isoformat() + 'Z' if external else None}
    overdue = db.query(PlannedTransaction.id).filter(PlannedTransaction.status == 'scheduled',
        PlannedTransaction.due_at < ledger_now() - timedelta(minutes=5)).count()
    result['scheduler']['overdue_count'] = overdue
    if overdue and result['scheduler']['configured']:
        result['scheduler']['healthy'] = False
    return result
