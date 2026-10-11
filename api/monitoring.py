"""Operational signals contain no account records, credentials or request bodies."""
from datetime import timedelta
import os
from .models import PlannedTransaction, utc_now
from .reliability_models import ServiceEvent
from .timekeeping import now as ledger_now


def record_job(db, area, status):
    row = db.query(ServiceEvent).filter_by(area=area).order_by(ServiceEvent.created_at.desc()).first()
    if row is None:
        row = ServiceEvent(area=area, status=status)
        db.add(row)
    row.status, row.created_at = status, utc_now()
    db.commit()


def job_status(db):
    result = {}
    for name, area, secret, minutes in (
        ('scheduler', 'scheduler-heartbeat', 'SCHEDULE_RUNNER_SECRET', 5),
        ('daily_backup', 'daily-recovery', 'CRON_SECRET', 2160),
    ):
        row = db.query(ServiceEvent).filter_by(area=area).order_by(ServiceEvent.created_at.desc()).first()
        configured = bool(os.getenv(secret))
        fresh = bool(row and row.status == 200 and row.created_at >= utc_now() - timedelta(minutes=minutes))
        result[name] = {'configured': configured, 'healthy': fresh if configured else None,
                        'last_run': row.created_at.isoformat() + 'Z' if row else None}
    overdue = db.query(PlannedTransaction.id).filter(PlannedTransaction.status == 'scheduled',
        PlannedTransaction.due_at < ledger_now() - timedelta(minutes=5)).count()
    result['scheduler']['overdue_count'] = overdue
    if overdue and result['scheduler']['configured']:
        result['scheduler']['healthy'] = False
    return result
