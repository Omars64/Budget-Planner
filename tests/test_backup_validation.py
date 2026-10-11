from copy import deepcopy
import pytest
from api.backup_validation import validate_archive_records


def archive():
    return {'settings': {}, 'budgets': [], 'goals': [], 'debts': [], 'wallets': [{'id': 1, 'name': 'Main'}],
            'categories': [{'id': 2, 'name': 'Food', 'kind': 'expense'}],
            'transactions': [{'id': 3, 'wallet_id': 1, 'category_id': 2, 'type': 'expense',
                              'amount': 1, 'description': 'Lunch', 'date': '2026-10-11T12:00:00'}]}


@pytest.mark.parametrize('change', ['duplicate', 'nonobject', 'settings', 'negative', 'workspace', 'folder', 'incomplete', 'precision', 'member_role', 'members'])
def test_invalid_archives_rejected_without_mutation(change):
    value = archive()
    if change == 'duplicate': value['wallets'].append(dict(value['wallets'][0]))
    if change == 'nonobject': value['transactions'] = [None]
    if change == 'settings': value['settings'] = []
    if change == 'negative': value['transactions'][0]['amount'] = -1
    if change == 'workspace': value['categories'][0]['space_id'] = 9
    if change == 'folder': value['notes'] = [{'id': 4, 'title': 'Note', 'folder_id': 99}]
    if change == 'incomplete': del value['transactions']
    if change == 'precision': value['transactions'][0]['amount'] = '1.1259'
    if change == 'member_role': value['spaces'] = [{'id': 5, 'members': [{'email': 'viewer@example.test'}]}]
    if change == 'members': value['spaces'] = [{'id': 5}]
    original = deepcopy(value)
    with pytest.raises(ValueError):
        validate_archive_records(value, ('wallets', 'categories', 'transactions', 'notes'))
    assert value == original


def test_valid_legacy_archive_remains_unchanged():
    value = archive()
    original = deepcopy(value)
    validate_archive_records(value, ('wallets', 'categories', 'transactions'))
    assert value == original
