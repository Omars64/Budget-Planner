"""Ask Budgetly guidance with server-calculated activity and optional admin-controlled AI."""
import re
from datetime import timedelta
from decimal import Decimal, InvalidOperation
import httpx
from fastapi import HTTPException
from .ai_context import build_context, transaction_fact, scope_wallets, ledger_query
from .ai_actions import target
from .ai_settings import assistant_status
from .ai_provider import complete, complete_draft
from .ai_diagnostics import provider_failure, user_notice
from .account_security import limit
from .timekeeping import now

LIMITED_MESSAGE = "I'm Ask Budgetly. My built-in guide covers Budgetly features, basic budgeting, and your selected activity. I don't have a built-in answer for that question. Try asking about a wallet, category, budget, goal, or how to use the app. I can't look up live news or market prices."


def _provider_notice(error):
    """Keep provider diagnostics out of the user-facing conversation."""
    return user_notice(provider_failure(error))

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
    if re.search(r'\b(forecast|cash.flow|planner|available to spend|shortfall)\b', lower) and facts.get('cash_flow_planner'):
        p = facts['cash_flow_planner']
        currency = facts.get('currency', 'KWD')
        risk = f"The balance could fall below your reserved money on {p['shortfall_date']}. The largest estimated gap is {currency} {p['shortfall_amount']}." if p['shortfall_date'] else f"No projected shortfall within these {p['days']} days using the items currently entered."
        return (f"Your available-to-spend estimate is **{currency} {p['available_to_spend']}**: current cash {p['opening_balance']}, minus reserved money {p['reserved']}, minus planned outgoings {p['bills_before_payday']} before your next known income (or the end of the forecast). Future income is not spendable cash today.\n\n"
                f"The projected closing balance is {currency} {p['projected_balance']}. {risk}\n\n"
                'Review unpaid items and missing bills in Planner. Try delaying a nonessential purchase in What if before deciding. These are estimates, not guarantees; no records were changed.')
    if re.search(r'\b(roadmap|reduce|cut back|spending plan|budget plan)\b', lower):
        return _roadmap(facts, question)
    if re.search(r'\b(how do|how can|how to|where can|where do|what is|what are|why)\b', lower):
        answer = _faq_answer(question)
        if answer:
            return answer
    return _activity_answer(facts, question) or _faq_answer(question) or LIMITED_MESSAGE


_NUMBER_WORDS = {
    'zero': 0, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
    'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10, 'eleven': 11,
    'twelve': 12, 'thirteen': 13, 'fourteen': 14, 'fifteen': 15,
    'sixteen': 16, 'seventeen': 17, 'eighteen': 18, 'nineteen': 19,
    'twenty': 20, 'thirty': 30, 'forty': 40, 'fifty': 50, 'sixty': 60,
    'seventy': 70, 'eighty': 80, 'ninety': 90,
}


def _word_number(value):
    tokens = re.findall(r'[a-z]+', value.lower())
    if not tokens or any(token not in _NUMBER_WORDS and token != 'point' for token in tokens):
        return None
    if 'point' in tokens:
        index = tokens.index('point')
        whole = _word_number(' '.join(tokens[:index])) if index else 0
        decimals = ''.join(str(_NUMBER_WORDS[token]) for token in tokens[index + 1:])
        return Decimal(f'{whole}.{decimals}') if decimals else Decimal(whole)
    total = 0
    for token in tokens:
        total += _NUMBER_WORDS[token]
    return Decimal(total)


def _amount_from_text(question):
    markers = r'(?:amount|spent|spend|paid|pay|received|receive|got|earned|transfer|send|sent|add|added)'
    numeric = re.search(rf'\b{markers}\b(?:\s+of)?\s+[^\d\n]{{0,24}}(\d+(?:[.,]\d{{1,3}})?)', question, re.I)
    if numeric:
        return Decimal(numeric.group(1).replace(',', '.'))
    spoken = re.search(r'\b([a-z]+)\s+point\s+([a-z]+)(?:\s+([a-z]+))?\b', question.lower())
    if spoken:
        parts = [part for part in spoken.groups() if part]
        if all(part in _NUMBER_WORDS for part in parts):
            return _word_number(' '.join(parts[:1] + ['point'] + parts[1:]))
    number_tokens = set(_NUMBER_WORDS) | {'point'}
    marker_tokens = set(re.findall(r'[a-z]+', markers))
    filler_tokens = {'a', 'an', 'the', 'transaction', 'expense', 'income', 'transfer', 'of'}
    tokens = re.findall(r'[a-z]+|\d+(?:[.,]\d+)?', question.lower())
    for index, token in enumerate(tokens):
        if token not in marker_tokens:
            continue
        cursor = index + 1
        while cursor < len(tokens) and tokens[cursor] in filler_tokens:
            cursor += 1
        found = []
        while cursor < len(tokens) and tokens[cursor] in number_tokens and len(found) < 9:
            found.append(tokens[cursor]); cursor += 1
        if found:
            return _word_number(' '.join(found))
    numeric = re.search(r'(?<!\w)(\d+(?:[.,]\d{1,3})?)(?!\w)', question)
    if numeric:
        return Decimal(numeric.group(1).replace(',', '.'))
    return None


def _match_name(value, rows):
    if not value:
        return None
    needle = re.sub(r'\band\b', ' ', str(value).lower())
    needle = re.sub(r'[^a-z0-9]+', ' ', needle).strip()
    candidates = []
    for row in rows:
        name = str(row.get('name', '')).strip()
        normalized = re.sub(r'\band\b', ' ', name.lower())
        normalized = re.sub(r'[^a-z0-9]+', ' ', normalized).strip()
        if normalized and (normalized == needle or normalized in needle or needle in normalized):
            candidates.append((len(normalized), row))
    return max(candidates, key=lambda item: item[0])[1] if candidates else None


def _name_in_text(text, rows):
    return _match_name(text, rows)


def _draft_intent(question):
    lower = question.lower()
    if re.search(r'\b(?:how do|how can|where do|where can|what is|what are|explain)\b', lower):
        return False
    return bool(re.search(r'\b(?:add|record|log|save|spent|spend|bought|buy|paid|pay|received|receive|earned|salary|income|transfer|send|sent|move)\b', lower))


def _draft_date(question):
    current = now().replace(second=0, microsecond=0)
    lower = question.lower()
    if 'yesterday' in lower:
        current -= timedelta(days=1)
    elif 'tomorrow' in lower:
        current += timedelta(days=1)
    match = re.search(r'\b(20\d{2}-\d{2}-\d{2})(?:\s+at\s+(\d{1,2}:\d{2}))?', lower)
    if match:
        return f"{match.group(1)}T{match.group(2) or current.strftime('%H:%M')}"
    return current.strftime('%Y-%m-%dT%H:%M')


def _draft_description(question, category, wallets, amount):
    text = question.strip()
    if category:
        text = re.split(r'\b(?:category|under|in\s+category)\b', text, maxsplit=1, flags=re.I)[0]
        text = re.sub(r'\b(?:for\s+)?(?:category|under|in\s+category)\s+' + re.escape(category['name']), '', text, flags=re.I)
        category_name = re.escape(category['name']).replace(r'\&', r'(?:&|and)')
        text = re.sub(r'\bfor\s+' + category_name + r'\b', '', text, flags=re.I)
    for wallet in wallets:
        name = re.escape(wallet['name'])
        text = re.sub(r'\b(?:from|into|using|with|wallet)\s+' + name + r'\b', '', text, flags=re.I)
    if amount is not None:
        text = re.sub(r'\b(?:\d+(?:[.,]\d{1,3})?|(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|point)(?:\s+(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|point)){0,8})\b', '', text, flags=re.I)
    text = re.sub(r'^\s*(?:please\s+)?(?:add|record|log|save|create)\s+(?:a\s+)?(?:transaction|expense|income|transfer)\b', '', text, flags=re.I)
    text = re.sub(r'^\s*(?:i\s+)?(?:spent|spend|bought|buy|paid|pay|received|receive|earned|got)\b', '', text, flags=re.I)
    text = re.sub(r'\b(?:today|yesterday|tomorrow|on\s+20\d{2}-\d{2}-\d{2}(?:\s+at\s+\d{1,2}:\d{2})?)\b', '', text, flags=re.I)
    text = re.sub(r'^\s*(?:for|at|on|in|from|using|with|into)\s+', '', text, flags=re.I)
    text = re.sub(r'\s+\b(?:for|at|on|in|from|using|with|into)\s*$', '', text, flags=re.I)
    return re.sub(r'\s+', ' ', text).strip(' ,.-')[:160]


def _local_draft(facts, chat, question):
    if not _draft_intent(question):
        return None
    amount = _amount_from_text(question)
    lower = question.lower()
    kind = 'transfer' if re.search(r'\b(?:transfer|send|sent|move)\b', lower) else 'income' if re.search(r'\b(?:received|receive|earned|salary|income|paid salary)\b', lower) else 'expense'
    wallets = facts.get('wallets', [])
    categories = [row for row in facts.get('categories', []) if row.get('kind') == kind]
    category = _name_in_text(question, categories) if kind != 'transfer' else None
    selected = _match_name(question, wallets)
    if chat.wallet_id:
        selected = next((row for row in wallets if row.get('id') == chat.wallet_id), selected)
    if not selected and len(wallets) == 1:
        selected = wallets[0]
    destination = None
    if kind == 'transfer':
        to_match = re.search(r'\bto\s+(.+?)(?=\s+(?:for|on|at|from|using)\b|$)', question, re.I)
        destination = _match_name(to_match.group(1), wallets) if to_match else None
        if destination and selected and destination.get('id') == selected.get('id'):
            selected = None
    description = _draft_description(question, category, wallets, amount)
    missing = []
    if amount is None or amount <= 0:
        missing.append('amount')
    if not selected:
        missing.append('wallet')
    if kind == 'transfer' and not destination:
        missing.append('destination wallet')
    if kind != 'transfer' and not category:
        missing.append('category')
    return {
        'type': kind, 'amount': str(amount.quantize(Decimal('.001'))) if amount and amount > 0 else None,
        'description': description or ('Income' if kind == 'income' else 'Transfer' if kind == 'transfer' else 'Expense'),
        'notes': '', 'date': _draft_date(question),
        'reporting_month': chat.month if kind == 'income' else None,
        'wallet_id': selected.get('id') if selected else None, 'wallet_name': selected.get('name') if selected else None,
        'transfer_wallet_id': destination.get('id') if destination else None,
        'transfer_wallet_name': destination.get('name') if destination else None,
        'category_id': category.get('id') if category else None, 'category_name': category.get('name') if category else None,
        'missing': missing, 'clarifying_question': f"Please choose the {' and '.join(missing)} before saving." if missing else '',
        'review_required': True,
    }


def _merge_provider_draft(base, candidate, facts, chat):
    if not isinstance(candidate, dict):
        return base
    candidate = candidate.get('draft') if isinstance(candidate.get('draft'), dict) else candidate
    result = dict(base)
    kind = candidate.get('type')
    if kind in {'income', 'expense', 'transfer'}:
        result['type'] = kind
    try:
        amount = Decimal(str(candidate.get('amount'))) if candidate.get('amount') is not None else None
        if amount and amount > 0:
            result['amount'] = str(amount.quantize(Decimal('.001')))
    except (InvalidOperation, ValueError, TypeError):
        pass
    for key in ('description', 'notes'):
        if isinstance(candidate.get(key), str) and candidate[key].strip():
            result[key] = candidate[key].strip()[:160 if key == 'description' else 4000]
    if isinstance(candidate.get('date'), str) and re.match(r'^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}$', candidate['date']):
        result['date'] = candidate['date']
    if isinstance(candidate.get('reporting_month'), str) and re.match(r'^20\d{2}-(0[1-9]|1[0-2])$', candidate['reporting_month']):
        result['reporting_month'] = candidate['reporting_month']
    wallets = facts.get('wallets', [])
    categories = [row for row in facts.get('categories', []) if row.get('kind') == result['type']]
    wallet = _match_name(candidate.get('wallet_name'), wallets)
    destination = _match_name(candidate.get('transfer_wallet_name'), wallets)
    category = _match_name(candidate.get('category_name'), categories)
    if chat.wallet_id:
        wallet = next((row for row in wallets if row.get('id') == chat.wallet_id), wallet)
    if wallet:
        result.update(wallet_id=wallet['id'], wallet_name=wallet['name'])
    if destination:
        result.update(transfer_wallet_id=destination['id'], transfer_wallet_name=destination['name'])
    if category and result['type'] != 'transfer':
        result.update(category_id=category['id'], category_name=category['name'])
    missing = []
    if not result.get('amount'): missing.append('amount')
    if not result.get('wallet_id'): missing.append('wallet')
    if result.get('type') == 'transfer' and not result.get('transfer_wallet_id'): missing.append('destination wallet')
    if result.get('type') != 'transfer' and not result.get('category_id'): missing.append('category')
    result['missing'] = missing
    result['clarifying_question'] = f"Please choose the {' and '.join(missing)} before saving." if missing else ''
    return result


def _draft_answer(draft):
    if draft.get('missing'):
        return 'I prepared a transaction draft, but I need ' + ', '.join(draft['missing']) + '. Review the highlighted details before saving.'
    return 'I prepared a transaction draft. Review the details, then use **Review in Transactions** to edit or save it. Nothing has been recorded yet.'


def generate(db, user, chat, question, history, research=False, still_active=lambda: True):
    if not still_active():
        raise HTTPException(409, 'Response stopped')
    horizon = re.search(r'\b(30|60|90)[ -]day\b', question, re.I)
    planner_assumptions = not re.search(r'\b(exclude|without|no) assumptions\b', question, re.I)
    facts, sources = build_context(db, user, chat, int(horizon.group(1)) if horizon else 30, planner_assumptions)
    draft = _local_draft(facts, chat, question)
    result = {'answer': _local_answer(facts, question)[:22000], 'sources': sources[:20],
              'suggestions': [], 'drafts': [draft] if draft else [], 'usage': {'provider': 'built-in', 'input_tokens': 0, 'output_tokens': 0}}
    if draft:
        result['answer'] = _draft_answer(draft)
    if assistant_status(db)['available']:
        try:
            # Provider limits do not prevent built-in answers from working.
            limit(db, 'openai-minute', 15, 60)
            limit(db, 'openai-day', 50, 86400)
            if not still_active():
                raise HTTPException(409, 'Response stopped')
            if assistant_status(db)['available']:
                if draft:
                    extracted = complete_draft(facts, question)
                    draft = _merge_provider_draft(draft, extracted.get('draft'), facts, chat)
                    result['drafts'] = [draft]
                    result['answer'] = _draft_answer(draft)
                    result['usage'].update(extracted['usage'])
                else:
                    result.update(complete(facts, question, history, '\n'.join(answer for _, answer in FAQS)))
        except HTTPException as error:
            if error.status_code != 429:
                raise
            result['usage']['fallback'] = 'AI request limit reached. Using built-in guidance.'
        except httpx.HTTPStatusError as error:
            # Never return provider error bodies or credentials to the client or logs.
            result['usage']['fallback'] = _provider_notice(error)
        except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError) as error:
            # Never return provider error bodies or credentials to the client or logs.
            result['usage']['fallback'] = _provider_notice(error)
    if result['drafts']:
        result['usage']['drafts'] = result['drafts']
    return result
