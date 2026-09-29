from __future__ import annotations

from datetime import timedelta
from decimal import Decimal, ROUND_HALF_UP

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .database import get_db
from .extensions import shared_wallet_ids
from .index import budget_spent, current_user, setting
from .models import Budget, Debt, Goal, PlannedTransaction, User, Wallet
from .timekeeping import ledger_iso, now as ledger_now

router = APIRouter()
MONEY_QUANTUM = Decimal("0.001")


def amount(value) -> Decimal:
    return Decimal(str(value or 0)).quantize(MONEY_QUANTUM, rounding=ROUND_HALF_UP)


def money(value, currency: str) -> str:
    return f"{currency} {amount(value):,.3f}"


def item(kind: str, severity: str, title: str, detail: str, path: str, **extra) -> dict:
    return {"id": f"{kind}:{extra.pop('source_id', '')}", "kind": kind, "severity": severity,
            "title": title, "detail": detail, "path": path, **extra}


def plan_items(db: Session, user: User, current) -> list[dict]:
    visible_wallet_ids = {row[0] for row in db.query(Wallet.id).filter(Wallet.user_id == user.id).all()}
    shared_ids = shared_wallet_ids(db, user)
    visible_wallet_ids.update(shared_ids)
    if not visible_wallet_ids:
        return []
    rows = db.query(PlannedTransaction).filter(
        PlannedTransaction.wallet_id.in_(visible_wallet_ids),
        PlannedTransaction.status.in_(("planned", "scheduled", "failed")),
    ).order_by(PlannedTransaction.due_at.asc()).all()
    result = []
    for row in rows:
        failed = row.status == "failed"
        due = row.due_at <= current
        if not failed and not due:
            continue
        shared = row.wallet_id in shared_ids
        label = "Fix upcoming record" if failed else "Review overdue record"
        detail = row.error or f"{row.description} was due {ledger_iso(row.due_at)}."
        result.append(item("plan", "danger", label, detail, "/upcoming", source_id=row.id,
                           action_label="Open upcoming", due_at=ledger_iso(row.due_at),
                           shared=shared, amount=f"{amount(row.amount):.3f}"))
    return result


def budget_items(db: Session, user: User, current, currency: str) -> list[dict]:
    result = []
    for budget in db.query(Budget).filter(Budget.user_id == user.id, Budget.limit_amount > 0).all():
        spent = amount(budget_spent(db, budget, as_of=current.date(), personal_only=True))
        limit = amount(budget.limit_amount)
        progress = spent / limit * 100
        threshold = budget.notify_threshold if budget.notify_threshold is not None else 80
        if progress < threshold:
            continue
        severity = "danger" if progress >= 100 else "warning"
        category = budget.category.name if budget.category else "all expenses"
        period_label = {"weekly": "this week", "yearly": "this year"}.get(budget.period, "this month")
        result.append(item("budget", severity, f"{budget.name} needs attention",
                           f"{money(spent, currency)} of {money(limit, currency)} used for {category} {period_label} ({progress:.0f}%).",
                           "/budgets", source_id=budget.id, action_label="Open budget", progress=min(float(progress), 999)))
    return result


def goal_debt_items(db: Session, user: User, current, currency: str) -> list[dict]:
    today = current.date()
    result = []
    for debt in db.query(Debt).filter(Debt.user_id == user.id, Debt.remaining > 0, Debt.due_date.isnot(None)).all():
        days = (debt.due_date - today).days
        if days > 14:
            continue
        overdue = days < 0
        title = "Debt payment overdue" if overdue else "Debt payment coming up"
        when = "was due" if overdue else f"is due in {days} day{'s' if days != 1 else ''}"
        result.append(item("debt", "danger" if overdue else "warning", title,
                           f"{debt.name}: {money(debt.remaining, currency)} remaining and {when} on {debt.due_date.isoformat()}.",
                           "/goals", source_id=debt.id, action_label="Open goals & debts", date=debt.due_date.isoformat()))
    for goal in db.query(Goal).filter(Goal.user_id == user.id, Goal.current_amount < Goal.target_amount,
                                       Goal.deadline.isnot(None)).all():
        days = (goal.deadline - today).days
        if days > 30:
            continue
        overdue = days < 0
        title = "Goal deadline passed" if overdue else "Goal deadline coming up"
        when = "passed" if overdue else f"is in {days} day{'s' if days != 1 else ''}"
        result.append(item("goal", "danger" if overdue else "info", title,
                           f"{goal.name} is {money(goal.current_amount, currency)} of {money(goal.target_amount, currency)} and the deadline {when} ({goal.deadline.isoformat()}).",
                           "/goals", source_id=goal.id, action_label="Open goals & debts", date=goal.deadline.isoformat()))
    return result


@router.get("/api/attention")
def attention(user: User = Depends(current_user), db: Session = Depends(get_db)):
    current = ledger_now()
    currency = setting(db, user.id, "currency", "KWD") or "KWD"
    rows = plan_items(db, user, current)
    rows.extend(budget_items(db, user, current, currency))
    rows.extend(goal_debt_items(db, user, current, currency))
    severity_rank = {"danger": 0, "warning": 1, "info": 2}
    rows.sort(key=lambda row: (severity_rank.get(row["severity"], 9), row.get("due_at") or row.get("date") or "9999", row["title"]))
    return {"items": rows[:25], "count": len(rows), "has_more": len(rows) > 25, "generated_at": ledger_iso(current)}
