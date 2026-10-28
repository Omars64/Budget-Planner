"""Pure, narrow compatibility for category links predating Spaces.

Only archived personal categories may be copied into a declared archived Space.
This never reads or edits live rows, changes money, or accepts cross-Space links.
The complete strict archive validator must still run after normalization.
"""
from copy import deepcopy
import hashlib
import json


def category_signature(row):
    metadata = {key: value for key, value in row.items() if key not in ('id', 'space_id')}
    return hashlib.sha256(json.dumps(metadata, sort_keys=True, separators=(',', ':')).encode()).digest()


def category_count_without_recovery_copies(data):
    """Count originals while allowing one equivalent personal-label copy per Space.

    Derived from the archive's actual contents, never from claimed metadata.
    This keeps the original category budget and a separately bounded physical
    count while making normalized archives valid on repeated imports.
    """
    rows = data.get('categories', [])
    spaces = {row.get('id') for row in data.get('spaces', [])
              if isinstance(row, dict) and type(row.get('id')) is int and row['id'] > 0}
    if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
        return len(rows) if isinstance(rows, list) else 0
    signatures = [(row, category_signature(row)) for row in rows]
    personal = {signature for row, signature in signatures if row.get('space_id') is None}
    copies = set()
    for row, signature in signatures:
        scope = row.get('space_id')
        if type(scope) is int and scope in spaces and signature in personal:
            copies.add((scope, signature))
    return len(rows) - len(copies)


def normalize_legacy_space_categories(data):
    if not isinstance(data, dict):
        return data
    names = ('wallets', 'categories', 'spaces', 'transactions', 'planned_transactions', 'budgets')
    for name in names:
        rows = data.get(name, [])
        if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
            return data
    for name in ('wallets', 'categories', 'spaces'):
        ids = [row.get('id') for row in data.get(name, [])]
        if any(type(value) is not int or value <= 0 for value in ids) or len(set(ids)) != len(ids):
            return data  # Never mask malformed identifiers or duplicate records.
    categories = {row['id']: row for row in data.get('categories', [])}
    wallets = {row['id']: row for row in data.get('wallets', [])}
    spaces = {row['id'] for row in data.get('spaces', [])}
    repairs = []
    for name in ('transactions', 'planned_transactions', 'budgets'):
        for index, row in enumerate(data.get(name, [])):
            category_id = row.get('category_id')
            if type(category_id) is not int:
                continue
            category = categories.get(category_id)
            if name == 'budgets':
                scope, kind = row.get('space_id'), 'expense'
            else:
                wallet_id = row.get('wallet_id')
                wallet = wallets.get(wallet_id) if type(wallet_id) is int else None
                if not wallet:
                    continue
                scope, kind = wallet.get('space_id'), row.get('type')
            if (type(scope) is int and scope in spaces and category
                    and category.get('space_id') is None
                    and category.get('kind') == kind and kind in ('income', 'expense')):
                repairs.append((name, index, category_id, scope))
    if not repairs:
        return data
    result = deepcopy(data)
    next_id = max(categories, default=0) + 1
    resolved, copied = {}, 0
    signatures = {category_id: category_signature(row) for category_id, row in categories.items()}
    matches = {}
    for row in result['categories']:
        scope = row.get('space_id')
        if scope is None or type(scope) is int:
            matches.setdefault((scope, signatures[row['id']]), row)
    for name, index, category_id, scope in repairs:
        identity = (category_id, scope)
        if identity not in resolved:
            source = categories[category_id]
            match = matches.get((scope, signatures[category_id]))
            if match is None:
                match = {**source, 'id': next_id, 'space_id': scope}
                result['categories'].append(match)
                next_id += 1
                copied += 1
                matches[(scope, signatures[category_id])] = match
            resolved[identity] = match['id']
        result[name][index]['category_id'] = resolved[identity]
    result['recovery_compatibility'] = {'legacy_space_category_links': len(repairs),
                                        'space_category_copies': copied}
    return result
