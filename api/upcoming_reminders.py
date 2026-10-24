"""Closed-browser expense reminders. Android uses its existing local alarm scheduler."""
import hashlib
import logging
import time
from datetime import datetime, timedelta

from . import update_push as push
from .models import PlannedTransaction, User, Wallet, utc_now
from .extensions import shared_wallet_ids
from .timekeeping import now as ledger_now


def reminder_at(due, preference):
    if preference.mode == 'before':
        return due - timedelta(minutes=preference.minutes)
    day = due.date() - timedelta(days=preference.days)
    hour, minute = map(int, preference.time.split(':'))
    return min(datetime.combine(day, datetime.min.time()).replace(hour=hour, minute=minute), due - timedelta(minutes=5))


def dispatch_upcoming(db):
    if not push.configured()['browser']:
        return {'sent': 0, 'failed': 0, 'configured': False}
    sent = failed = 0
    now = ledger_now()
    db.query(push.UpcomingPushReceipt).filter(push.UpcomingPushReceipt.sent_at < utc_now() - timedelta(days=60)).delete(synchronize_session=False)
    # The device row serializes overlapping minute jobs without blocking ledger posting.
    query = db.query(push.UpdatePushDevice).filter_by(platform='browser').order_by(push.UpdatePushDevice.updated_at)
    if db.bind.dialect.name == 'postgresql':
        query = query.with_for_update(skip_locked=True)
    deadline = time.monotonic() + 6
    for device in query.all():
        if time.monotonic() >= deadline:
            break
        stage = 'profile'
        try:
            preference = push.UpcomingPreference.model_validate(push.device_payload(device).get('upcoming', {}))
            stage = 'account'
            user = db.get(User, device.user_id)
            if not preference.enabled or not user or not user.active:
                continue
            stage = 'access'
            wallet_ids = shared_wallet_ids(db, user) | {row[0] for row in db.query(Wallet.id).filter_by(user_id=user.id, archived=False)}
            stage = 'plans'
            plans = db.query(PlannedTransaction).join(Wallet, PlannedTransaction.wallet_id == Wallet.id).filter(
                PlannedTransaction.wallet_id.in_(wallet_ids), Wallet.archived.is_(False),
                PlannedTransaction.status.in_(['planned', 'scheduled']), PlannedTransaction.type == 'expense',
                PlannedTransaction.reminder_enabled.is_(True), PlannedTransaction.due_at > now,
                PlannedTransaction.due_at <= now + timedelta(days=31),
            ).order_by(PlannedTransaction.due_at, PlannedTransaction.id).all()
            for plan in plans:
                if time.monotonic() >= deadline:
                    break
                stage = 'timing'
                when = reminder_at(plan.due_at, preference)
                if not now - timedelta(hours=6) < when <= now:
                    continue
                occurrence = hashlib.sha256(f'{plan.id}:{plan.due_at.isoformat()}'.encode()).hexdigest()
                if db.get(push.UpcomingPushReceipt, (device.id, occurrence)):
                    continue
                notice = {'kind': 'upcoming', 'event': occurrence, 'version': push.VERSION,
                          'title': 'Upcoming expense', 'body': f'{plan.description[:160]} - due {plan.due_at:%d %b, %H:%M} (Kuwait)'}
                stage = 'provider'
                status = push.send_device(device, push.VERSION, notice=notice)
                if 200 <= status < 300:
                    stage = 'receipt'
                    db.add(push.UpcomingPushReceipt(device_id=device.id, occurrence=occurrence))
                    db.flush()
                    sent += 1
                elif status in (404, 410):
                    # Device-local preferences survive; the next visit can register this ID again.
                    db.delete(device)
                    break
                else:
                    logging.getLogger('flowbudget').warning('upcoming_reminder_failure stage=provider status=%d', status)
                    failed += 1
                    break
        except Exception as error:
            logging.getLogger('flowbudget').warning('upcoming_reminder_failure stage=%s type=%s', stage, type(error).__name__)
            failed += 1
    db.commit()
    return {'sent': sent, 'failed': failed, 'configured': True}
