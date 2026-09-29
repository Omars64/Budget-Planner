"""Shared ledger filtering uses the same Kuwait wall time as stored transactions."""
from typing import Literal, Optional

from fastapi import HTTPException, Query

from .models import Transaction


def ledger_options(
    month: Optional[str] = Query(None, pattern=r"^[1-9][0-9]{3}-(0[1-9]|1[0-2])$"),
    reporting_from: Optional[str] = Query(None, pattern=r"^[1-9][0-9]{3}-(0[1-9]|1[0-2])$"),
    reporting_to: Optional[str] = Query(None, pattern=r"^[1-9][0-9]{3}-(0[1-9]|1[0-2])$"),
    sort: Literal['newest', 'oldest'] = 'newest',
    offset: int = Query(0, ge=0),
    exclude_opening: bool = False,
):
    if reporting_from and reporting_to and reporting_from > reporting_to:
        raise HTTPException(422, 'Reporting month range must be in chronological order')
    return month, reporting_from, reporting_to, sort, offset, exclude_opening


def filter_ledger(query, options):
    month, reporting_from, reporting_to, sort, offset, exclude_opening = options
    if exclude_opening:
        query = query.filter(Transaction.is_opening_balance.is_(False))
    if month:
        query = query.filter(Transaction.reporting_month == month)
    if reporting_from:
        query = query.filter(Transaction.reporting_month >= reporting_from)
    if reporting_to:
        query = query.filter(Transaction.reporting_month <= reporting_to)
    order = (Transaction.date.asc(), Transaction.id.asc()) if sort == 'oldest' else (Transaction.date.desc(), Transaction.id.desc())
    return query.order_by(*order).offset(offset)
