"""Shared ledger filtering uses the same Kuwait wall time as stored transactions."""
from datetime import datetime
from typing import Literal, Optional

from fastapi import Query

from .models import Transaction


def ledger_options(
    month: Optional[str] = Query(None, pattern=r"^[1-9][0-9]{3}-(0[1-9]|1[0-2])$"),
    sort: Literal['newest', 'oldest'] = 'newest',
    offset: int = Query(0, ge=0),
):
    return month, sort, offset


def filter_ledger(query, options):
    month, sort, offset = options
    if month:
        year, number = map(int, month.split('-'))
        start = datetime(year, number, 1)
        query = query.filter(Transaction.date >= start)
        if year < 9999 or number < 12:
            end = datetime(year + (number == 12), number % 12 + 1, 1)
            query = query.filter(Transaction.date < end)
    order = (Transaction.date.asc(), Transaction.id.asc()) if sort == 'oldest' else (Transaction.date.desc(), Transaction.id.desc())
    return query.order_by(*order).offset(offset)
