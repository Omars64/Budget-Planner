"""Read-only deadlines for the scheduled-transactions endpoint."""
import hashlib
from datetime import datetime, timedelta, timezone

from sqlalchemy import func

from . import update_push as push
from .extensions import shared_wallet_ids
from .models import PlannedTransaction, User, Wallet
from .timekeeping import KUWAIT
from .upcoming_reminders import reminder_at


def next_scheduler_wake(db, nowUTC: datetime) -> datetime | None:
    """Return the earliest UTC work deadline, or None for an idle snapshot.

    Naive input means UTC (as with models.utc_now); aware input returns aware
    UTC. Overdue work and uncertainty return now. No flush, commit, rollback,
    delivery, or ledger mutation is performed. Query failures also fail open;
    callers remain responsible for retrying failed jobs independently.

    This is a snapshot: the external gate must be invalidated when plans,
    devices, preferences, receipts, or access change. Sender configuration is
    deliberately not used to postpone work, since it can change outside DB.
    Quiet-hour AppSettings are not applied by dispatch_upcoming, so using them
    to delay this deadline would be unsafe. Unsent reminders retry immediately
    within that dispatcher's six-hour catch-up window.
    """
    now = nowUTC.replace(tzinfo=timezone.utc) if nowUTC.tzinfo is None else nowUTC.astimezone(timezone.utc)

    def result(value):
        return value.replace(tzinfo=None) if nowUTC.tzinfo is None else value

    try:
        # Pending caller changes cannot safely be summarized without a flush.
        if db.new or db.dirty or db.deleted:
            return result(now)
        with db.no_autoflush:
            wake = _next_wake(db, now)
            return result(wake) if wake is not None else None
    except Exception:
        return result(now)


def _next_wake(db, now):
    due = db.query(func.min(PlannedTransaction.due_at)).filter(
        PlannedTransaction.status == 'scheduled').scalar()
    wake = max(now, due.replace(tzinfo=KUWAIT).astimezone(timezone.utc)) if due else None
    if wake == now:
        return now
    # Even expired, cancelled, or opted-out outbox rows need dispatch to retire
    # them. There is no persisted next-attempt/backoff field in this outbox.
    if db.query(push.ScheduledPush.id).filter(push.ScheduledPush.sent_at.is_(None)).first():
        return now

    local_now = now.astimezone(KUWAIT).replace(tzinfo=None)
    for device in db.query(push.UpdatePushDevice).filter_by(platform='browser').all():
        user = db.get(User, device.user_id)
        if not user or not user.active:
            continue
        preference = push.UpcomingPreference.model_validate(push.device_payload(device).get('upcoming', {}))
        if not preference.enabled:
            continue
        wallet_ids = shared_wallet_ids(db, user) | {
            row[0] for row in db.query(Wallet.id).filter_by(user_id=user.id, archived=False)
        }
        plans = db.query(PlannedTransaction).join(Wallet, PlannedTransaction.wallet_id == Wallet.id).filter(
            PlannedTransaction.wallet_id.in_(wallet_ids), Wallet.archived.is_(False),
            PlannedTransaction.status.in_(['planned', 'scheduled']),
            PlannedTransaction.type == 'expense', PlannedTransaction.reminder_enabled.is_(True),
            PlannedTransaction.due_at > local_now,
        )
        for plan in plans:
            when = reminder_at(plan.due_at, preference)
            if when <= local_now - timedelta(hours=6):
                continue
            occurrence = hashlib.sha256(f'{plan.id}:{plan.due_at.isoformat()}'.encode()).hexdigest()
            if db.get(push.UpcomingPushReceipt, (device.id, occurrence)):
                continue
            # Include far-future plans, but never wake later than their first
            # eligibility in dispatch_upcoming's 31-day query horizon.
            eligible = max(when, plan.due_at - timedelta(days=31))
            candidate = max(now, eligible.replace(tzinfo=KUWAIT).astimezone(timezone.utc))
            if candidate == now:
                return now
            wake = min(wake, candidate) if wake else candidate
    return wake
