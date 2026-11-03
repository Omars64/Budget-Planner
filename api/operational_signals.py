"""Bounded, non-identifying service signals shared by readiness and admin UI.

No request payloads, account IDs, balances, or exception messages are returned.
Normal validation/permission conflicts (4xx) are deliberately not outages.
"""
from datetime import timedelta
from sqlalchemy import case, func, or_
from .models import utc_now
from .reliability_models import ServiceEvent

WINDOW_MINUTES = 15
FAILED_SAVE_THRESHOLD = 3
FINANCIAL_ROUTES = (
    '/api/transactions', '/api/shared/transactions', '/api/planned-transactions',
    '/api/wallets', '/api/shared/wallets', '/api/budgets', '/api/goals', '/api/debts',
    '/api/bank-inbox', '/api/bank-messages',
)


def operational_signals(db, *, now=None):
    now = now or utc_now()
    financial = or_(*(or_(ServiceEvent.area == route,
                         ServiceEvent.area.like(route + '/%')) for route in FINANCIAL_ROUTES))
    failure = financial & (ServiceEvent.status >= 500)
    row = db.query(
        func.coalesce(func.sum(case((failure, 1), else_=0)), 0),
        func.coalesce(func.sum(case((ServiceEvent.area.like('client:%'), 1), else_=0)), 0),
        func.coalesce(func.sum(case((ServiceEvent.duration_ms >= 2000, 1), else_=0)), 0),
    ).filter(ServiceEvent.created_at >= now - timedelta(minutes=WINDOW_MINUTES),
             ServiceEvent.created_at <= now).one()
    return {'window_minutes': WINDOW_MINUTES, 'failed_financial_requests': int(row[0]),
            'client_errors': int(row[1]), 'slow_requests': int(row[2]),
            'failed_request_threshold': FAILED_SAVE_THRESHOLD,
            'healthy': row[0] < FAILED_SAVE_THRESHOLD}
