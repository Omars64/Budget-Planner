"""Ask Budgetly guidance with server-calculated activity and optional admin-controlled AI."""
import re
from decimal import Decimal, InvalidOperation
import httpx
from fastapi import HTTPException
from .ai_context import build_context, transaction_fact, scope_wallets, ledger_query
from .ai_actions import target
from .ai_settings import assistant_status
from .ai_provider import complete
from .account_security import limit

LIMITED_MESSAGE = "I'm Ask Budgetly. My built-in guide covers Budgetly features, basic budgeting, and your selected activity. I don't have a built-in answer for that question. Try asking about a wallet, category, budget, goal, or how to use the app. I can't look up live news or market prices."

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
    except (InvalidOperation, ValueError, TypeError):
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
    category = _matching_category(facts, question)
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
    lower = re.sub(r'\b(a|an|the|my|our)\b', ' ', question.lower())
    lower = ' '.join(lower.split())
    matches = [(len(keyword), answer) for keywords, answer in FAQS for keyword in keywords
               if re.search(r'\b' + re.escape(keyword) + r'\b', lower)]
    if matches:
        return max(matches, key=lambda item: item[0])[1]
    return None


def _matching_category(facts, question):
    words = set(re.findall(r'\w+', question.lower()))
    rows = list((facts.get('ledger') or {}).get('expense_categories', []))
    known = {row['category'].lower() for row in rows}
    rows += [{'category': row['name'], 'amount': '0'} for row in facts.get('categories', [])
             if row['kind'] == 'expense' and row['name'].lower() not in known]
    candidates = []
    for row in rows:
        terms = set(re.findall(r'\w+', row['category'].lower())) - {'and', 'the', 'other'}
        score = len(terms & words)
        if score:
            candidates.append((score, row))
    return max(candidates, key=lambda item: item[0])[1] if candidates else None


def _roadmap(facts, question):
    category = _matching_category(facts, question)
    ledger = facts.get('ledger') or {}
    currency = facts.get('currency', 'KWD')
    amount = _decimal(category['amount'] if category else ledger.get('totals', {}).get('expense'))
    title = category['category'] if category else 'your spending categories'
    baseline = (f"Your recorded {facts.get('month', '')} spending " +
                (f"in **{title}**" if category else 'across categories') +
                f" is **{_money(amount, currency)}**. This is month-to-date, not a full-month forecast.\n\n") if amount else ''
    return (f"**A four-week roadmap for {title}**\n\n" + baseline +
        '- **Week 1: Review.** Filter Transactions by month and category. Separate essentials, optional purchases, and repeat charges.\n'
        '- **Week 2: Choose a limit.** Use a complete typical month as your baseline. Try a manageable reduction, such as 10%, without cutting essentials. Add the chosen limit in Budgets.\n'
        '- **Week 3: Change one habit.** Pick the biggest avoidable expense in the category, compare alternatives, and check the remaining budget weekly.\n'
        '- **Week 4: Compare and adjust.** Compare actual spending with the baseline. Keep changes that work and set a realistic limit for next month.\n\n'
        'No records have been changed. Tell me the category name to focus this plan.' )


def _local_answer(facts, question):
    lower = question.lower()
    if re.search(r'\b(roadmap|reduce|cut back|spending plan|budget plan)\b', lower):
        return _roadmap(facts, question)
    if re.search(r'\b(how do|how can|how to|where can|where do|what is|what are|why)\b', lower):
        answer = _faq_answer(question)
        if answer:
            return answer
    return _activity_answer(facts, question) or _faq_answer(question) or LIMITED_MESSAGE


def generate(db, user, chat, question, history, research=False, still_active=lambda: True):
    if not still_active():
        raise HTTPException(409, 'Response stopped')
    facts, sources = build_context(db, user, chat)
    result = {'answer': _local_answer(facts, question)[:22000], 'sources': sources[:20],
              'suggestions': [], 'drafts': [], 'usage': {'provider': 'built-in', 'input_tokens': 0, 'output_tokens': 0}}
    if assistant_status(db)['available']:
        try:
            # Provider limits do not prevent built-in answers from working.
            limit(db, 'openai-minute', 15, 60)
            limit(db, 'openai-day', 50, 86400)
            if not still_active():
                raise HTTPException(409, 'Response stopped')
            if assistant_status(db)['available']:
                result.update(complete(facts, question, history, '\n'.join(answer for _, answer in FAQS)))
        except HTTPException as error:
            if error.status_code != 429:
                raise
            result['usage']['fallback'] = 'AI request limit reached. Using built-in guidance.'
        except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError):
            # Never return provider error bodies or credentials to the client or logs.
            result['usage']['fallback'] = 'AI is temporarily unavailable. Using built-in guidance.'
    return result
