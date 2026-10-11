"""Validate archive structure before any replacement writes are attempted."""
from datetime import datetime
from decimal import Decimal, InvalidOperation

from .schemas import CategoryIn, DebtIn, GoalIn, TransactionIn, WalletIn


def validate_archive_records(data, collections):
    required = ('settings', 'wallets', 'categories', 'transactions', 'budgets', 'goals', 'debts')
    if any(key not in data for key in required):
        raise ValueError('Incomplete archive; core collections are required')
    settings = data.get('settings', {})
    if not isinstance(settings, dict) or any(not isinstance(key, str) for key in settings):
        raise ValueError('Invalid settings archive')
    for name in collections:
        if any(not isinstance(row, dict) for row in data.get(name, [])):
            raise ValueError('Invalid archive record')
    for space in data.get('spaces', []):
        if not isinstance(space.get('members'), list) or any(
            not isinstance(member, dict) or member.get('role') not in {'view', 'add', 'edit'}
            for member in space['members']
        ):
            raise ValueError('Explicit Space membership and roles are required')
    monetary_fields = {
        'wallets': ('initial_balance',), 'transactions': ('amount',),
        'planned_transactions': ('amount',), 'budgets': ('limit_amount',),
        'goals': ('target_amount', 'current_amount'), 'debts': ('principal', 'remaining', 'minimum_payment', 'interest_rate'),
    }
    for name, fields in monetary_fields.items():
        for row in data.get(name, []):
            for field in fields:
                if field not in row:
                    continue
                try:
                    value = Decimal(str(row[field]))
                except InvalidOperation as error:
                    raise ValueError('Invalid archive money') from error
                if not value.is_finite() or abs(value) >= Decimal('10000000000000') or value * 1000 != (value * 1000).to_integral_value():
                    raise ValueError('Archive money must fit the stored three-decimal precision')
                if field == 'interest_rate' and value >= Decimal('100000'):
                    raise ValueError('Archive interest rate is too large')
    indexed = ('spaces', 'wallets', 'categories', 'transactions', 'planned_transactions',
               'budgets', 'goals', 'debts', 'notes', 'note_folders')
    for name in indexed:
        identifiers = [row.get('id') for row in data.get(name, [])]
        if any(type(value) is not int or value <= 0 for value in identifiers):
            raise ValueError('Invalid archive identifier')
        if len(set(identifiers)) != len(identifiers):
            raise ValueError('Duplicate archive identifier')
    for name, schema in (('wallets', WalletIn), ('categories', CategoryIn),
                         ('goals', GoalIn), ('debts', DebtIn)):
        for row in data.get(name, []):
            schema.model_validate(row)
    wallets = {row['id']: row for row in data.get('wallets', [])}
    categories = {row['id']: row for row in data.get('categories', [])}
    for name in ('transactions', 'planned_transactions'):
        for row in data.get(name, []):
            payload = dict(row)
            payload['date'] = row.get('date') if name == 'transactions' else row.get('due_at')
            timestamp = datetime.fromisoformat(payload['date'])
            payload['reporting_month'] = row.get('reporting_month') or timestamp.strftime('%Y-%m')
            TransactionIn.model_validate(payload)
            amount = Decimal(str(row['amount']))
            if not amount.is_finite() or amount >= Decimal('10000000000000'):
                raise ValueError('Invalid archive amount')
            source = wallets.get(row.get('wallet_id'))
            destination = wallets.get(row.get('transfer_wallet_id'))
            category = categories.get(row.get('category_id'))
            if not source:
                raise ValueError('Missing archive wallet')
            if row.get('transfer_wallet_id') and (not destination or destination.get('space_id') != source.get('space_id')):
                raise ValueError('Invalid transfer workspace')
            if row.get('category_id') and (not category or category['kind'] != row['type'] or category.get('space_id') != source.get('space_id')):
                raise ValueError('Invalid category workspace')
            if name == 'planned_transactions' and row.get('status') not in {'planned', 'scheduled', 'posted', 'failed'}:
                raise ValueError('Invalid planned status')
    folders = {row['id']: row for row in data.get('note_folders', [])}
    from .workspace import validate_note_attachment
    for note in data.get('notes', []):
        validate_note_attachment(note.get('attachment_data'), note.get('attachment_type'), note.get('note_type', 'text'))
        if not isinstance(note.get('title'), str) or not 1 <= len(note['title']) <= 160:
            raise ValueError('Invalid note title')
        folder = folders.get(note.get('folder_id'))
        if note.get('folder_id') and (not folder or folder.get('space_id') != note.get('space_id')):
            raise ValueError('Invalid note folder')
