"""Built-in Budgetly Help answers with safe, server-calculated activity summaries."""
import json
import re
from decimal import Decimal
from fastapi import HTTPException
from .ai_context import build_context, transaction_fact, scope_wallets, ledger_query
from .ai_actions import target, serialize

LIMITED_MESSAGE = "I'm Budgetly Help, a built-in guide. I can explain Budgetly features, basic budgeting, and the activity in the selected wallet and month. I can't answer unrelated questions, current news, or live economic research."

FAQS = [
    (('add transaction', 'new transaction', 'record expense', 'record income'), "Open **Transactions** and select **Add transaction**. On Android, use the round **+** button. Choose Expense, Income, or Transfer, then enter the amount, date, wallet, category, and description before saving."),
    (('shared transaction', 'share wallet', 'shared wallet', 'invite user'), "Open **Shared transactions**, choose **Share a wallet**, select a wallet, and invite the registered user by email. View, Add, and Edit permissions control what that person can do. The wallet owner keeps control of sharing and deletion."),
    (('filter transaction', 'sort transaction', 'filter records', 'month filter'), "On **Transactions** or **Shared transactions**, use the filter icon to choose a wallet, month, type, search text, and sort order. The wallet balance cards show the current amount before you review the ledger."),
    (('budget', 'budgets'), "Budgets set a spending limit for a category and period. Open **Budgets** to add or edit one. Review the used and remaining amount during the month; a budget does not automatically move money between wallets."),
    (('goal', 'goals', 'saving goal'), "Open **Goals & debts** to create or edit a goal. Set a target, optional deadline, and current progress. Record progress as it changes so the percentage and remaining amount stay meaningful."),
    (('debt', 'debts', 'repayment'), "Open **Goals & debts** to add or edit a debt. Keep the principal, remaining amount, interest, minimum payment, and due date current. A simple plan is to cover minimums first, then direct extra money to one priority debt."),
    (('wallet', 'wallets'), "Open **Wallets** to view balances, add another wallet, edit wallet details, or remove an extra wallet. **Main wallet** is protected: resetting the workspace clears its balance to zero but does not remove it."),
    (('reset workspace', 'reset all', 'clear workspace'), "Workspace reset clears transactions and resets the Main wallet balance to zero. Default categories and the Main wallet are kept. Use it only when you intentionally want to clear your records; deleted records may be recoverable from Trash depending on the action."),
    (('note', 'notes', 'folder'), "Open **Notes** to create a plain note or checklist, place it in a folder, search it, share it with another Budgetly user, and move unwanted notes to Trash. Notes are separate from transactions."),
    (('dark mode', 'light mode', 'accent color', 'wallpaper', 'appearance'), "Open **Settings > Display and locale** to choose Light or Dark mode, change the accent color, and enable or disable the wallpaper. Text contrast adapts to the selected appearance."),
    (('biometric', 'passkey', 'fingerprint', 'face unlock'), "Open **Settings > Registered passkeys** and enroll the device security method. On sign-in, choose Password or Biometric / passkey. If the device cannot authenticate, use the password option and register the passkey again from Settings."),
    (('keep me signed in', 'stay signed in', 'remember me'), "Enable **Keep me signed in on this device** during sign-in. You can reverse it by signing out and signing in again with the option unchecked. Use this only on a device you control."),
    (('reminder', 'notification', 'notifications'), "Open **Settings > Reminders** to enable transaction reminders and choose the interval. Android notifications also need permission from the device. Browser reminders depend on browser notification permission and may be limited when the browser is closed."),
    (('bank message', 'bank sms', 'bank messages'), "**Bank messages** can import supported Kuwait bank transaction messages through the configured forwarding method. It does not connect directly to your bank account. Review every imported message before using it as a transaction."),
    (('sign up', 'signup', 'create account', 'verify email'), "Choose **Create an account**, enter your name, email, and password, then enter the six-digit verification code sent to your email. Check Junk or Quarantine if the message is not in the inbox."),
    (('sign in', 'signin', 'login', 'log in', 'password'), "Use your email and password on the sign-in screen. The eye icon reveals the password while you type. You can use the Biometric / passkey option after registering it in Settings."),
    (('delete account', 'remove account'), "Open **Settings > Account** and choose Delete account. Read the confirmation carefully because account deletion removes your personal data and shared access. Export anything you need first."),
    (('admin', 'administrator', 'feedback'), "Administrators can manage users, categories, and feedback from the Admin area. Regular users only see their own workspace and the shared wallets they have permission to access."),
    (('how budget', 'why budget', 'budgeting important', 'save money'), "A useful budget is a simple plan for incoming money: cover essentials, set aside savings, allow realistic personal spending, and review actual transactions weekly. Start with one month of records instead of trying to predict everything perfectly."),
]


def read_record(db, user, chat, kind, record_id):
    if chat.scope == 'general':
        raise HTTPException(403, 'General conversations have no financial data attached')
    if kind == 'transaction':
        ids = {w.id for w in scope_wallets(db, user, chat)}
        row = ledger_query(db, user, chat, ids).filter_by(id=record_id).first()
        if not row:
            raise HTTPException(404, 'Record not available in this context')
        data = transaction_fact(row, ids)
        path = '/shared-transactions' if chat.scope == 'shared' else '/transactions'
    else:
        if chat.scope != 'personal':
            raise HTTPException(403, 'Personal records are excluded from shared conversations')
        row = target(db, user, chat, kind, record_id)
        allowed = {'budget': ('name', 'category_id', 'limit_amount', 'period', 'start_date'),
                   'goal': ('name', 'target_amount', 'current_amount', 'deadline'),
                   'debt': ('name', 'principal', 'remaining', 'interest_rate', 'minimum_payment', 'due_date'),
                   'note': ('title', 'content')}[kind]
        data = {k: getattr(row, k) for k in allowed}
        if kind == 'note':
            data['content'] = data['content'][:8000]
        path = {'budget': '/budgets', 'goal': '/goals', 'debt': '/goals', 'note': '/notes'}[kind]
    key = f'{kind}:{row.id}'
    data['reference'] = key
    return data, {'key': key, 'label': getattr(row, 'description', None) or getattr(row, 'name', None) or getattr(row, 'title', key), 'kind': kind, 'id': row.id, 'path': path}


def _decimal(value):
    try:
        return Decimal(str(value or 0))
    except (ValueError, TypeError):
        return Decimal('0')


def _money(value, currency):
    return f'{currency} {_decimal(value):.3f}'


def _activity_answer(facts, question):
    lower = question.lower()
    if facts.get('scope') == 'general':
        return None
    currency = facts.get('currency', 'KWD')
    wallets = facts.get('wallets', [])
    ledger = facts.get('ledger') or {}
    if any(word in lower for word in ('balance', 'remaining', 'wallet amount', 'how much do i have')):
        if not wallets:
            return 'There are no wallets attached to this conversation.'
        rows = '\n'.join(f"- **{w['name']}**: {_money(w['balance'], currency)}" for w in wallets)
        return f"Here are the current wallet balances:\n\n{rows}\n\nThese are current balances, while the selected month is used for transaction totals."
    category = next((row for row in ledger.get('expense_categories', []) if any(term in lower and term in row['category'].lower() for term in ('food', 'dining', 'shopping', 'transport', 'bills', 'entertainment'))), None)
    if category and any(word in lower for word in ('spend', 'spent', 'expense', 'cost', 'category')):
        return f"For **{category['category']}** in {facts.get('month', 'the selected month')}, the recorded expenses total **{_money(category['amount'], currency)}**. Use the transaction filter to review the individual records."
    if any(word in lower for word in ('income', 'earned', 'salary')):
        return f"Recorded income for {facts.get('month', 'the selected month')}: **{_money(ledger.get('totals', {}).get('income'), currency)}**."
    if any(word in lower for word in ('spend', 'spent', 'expense', 'expenses', 'transaction', 'transactions', 'food', 'dining')):
        total = ledger.get('totals', {}).get('expense', '0')
        records = ledger.get('records', [])[:5]
        recent = '\n'.join(f"- {row.get('description') or 'Untitled'}: {_money(row.get('amount'), currency)} ({row.get('date', '')[:10]})" for row in records if row.get('type') == 'expense')
        suffix = f"\n\nRecent records:\n{recent}" if recent else ''
        return f"Recorded expenses for {facts.get('month', 'the selected month')}: **{_money(total, currency)}**.{suffix}\n\nTotals include all matching records; the list above is only a short recent preview."
    if any(word in lower for word in ('budget', 'goal', 'debt')) and any(key in facts for key in ('budgets', 'goals', 'debts')):
        parts = []
        for key in ('budgets', 'goals', 'debts'):
            rows = facts.get(key) or []
            if rows:
                parts.append(f"**{key.title()}**\n" + '\n'.join(f"- {row.get('name')}: {_money(row.get('limit_amount', row.get('target_amount', row.get('remaining'))), currency)}" for row in rows[:8]))
        return '\n\n'.join(parts) if parts else 'There are no budgets, goals, or debts recorded yet.'
    return None


def _faq_answer(question):
    lower = question.lower()
    for keywords, answer in FAQS:
        if any(keyword in lower for keyword in keywords):
            return answer
    return None


def _local_answer(facts, question):
    return _activity_answer(facts, question) or _faq_answer(question) or LIMITED_MESSAGE


def generate(db, user, chat, question, history, research=False, still_active=lambda: True):
    if not still_active():
        raise HTTPException(409, 'Response stopped')
    facts, sources = build_context(db, user, chat)
    answer = _local_answer(facts, question)
    # Keep the response deterministic and local. The zero usage record makes this explicit in admin diagnostics.
    return {'answer': answer[:22000], 'sources': sources[:20], 'suggestions': [], 'drafts': [],
            'usage': {'input_tokens': 0, 'output_tokens': 0}}
