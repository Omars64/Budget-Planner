"""Ledger dates use Kuwait wall time; event timestamps use UTC."""
from datetime import datetime, timezone, timedelta

KUWAIT = timezone(timedelta(hours=3), 'Asia/Kuwait')


def ledger_time(value):
    if value.tzinfo is not None:
        return value.astimezone(KUWAIT).replace(tzinfo=None)
    return value


def ledger_iso(value):
    return ledger_time(value).replace(tzinfo=KUWAIT).isoformat()


def now():
    return datetime.now(KUWAIT).replace(tzinfo=None)


def today():
    return now().date()
