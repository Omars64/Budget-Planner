from tests import test_api  # Configure the disposable database before importing the app.
from tests.test_spaces import spaces, transaction
from sqlalchemy.orm import Session
from api.models import BankCandidate, BankMerchantMemory, Transaction


def alert(**changes):
    return {'content_hash': 'a'*64, 'source_package': 'test.bank', 'source_app': 'Test Bank', 'transaction_type': 'expense',
        'amount': '6.750', 'currency': 'KWD', 'merchant': 'Talabat', 'account_last4': '1234',
        'occurred_at': '2026-10-08T12:00:00+03:00', 'confidence': '0.95', 'reasons': ['Amount detected'], **changes}


def test_notification_ingestion_private_scoped_and_idempotent(spaces):
    client, engine, actor, ids = spaces
    result = client.post('/api/bank-inbox/ingest', json=alert())
    assert result.status_code == 201, result.text
    item = result.json()['id']
    assert client.post('/api/bank-inbox/ingest', json=alert()).json()['id'] == item
    assert client.get('/api/bank-inbox?space_id=personal').json()['total'] == 1
    assert client.get(f"/api/bank-inbox?space_id={ids['space']}").json()['total'] == 0
    actor['id'] = ids['member']
    assert client.get('/api/bank-inbox').json()['total'] == 0
    assert client.post(f'/api/bank-inbox/{item}/approve?space_id=personal', json=transaction(ids['private'])).status_code == 404
    actor['id'] = ids['owner']
    with Session(engine) as db:
        assert db.query(BankCandidate).count() == 1


def test_mapping_routes_to_space_and_approval_is_regular_atomic_ledger_write(spaces):
    client, engine, actor, ids = spaces
    actor['id'] = ids['member']
    mapped = client.put('/api/bank-inbox/mappings', json={'source_package': 'test.bank', 'account_last4': '1234', 'wallet_id': ids['wallet']})
    assert mapped.status_code == 200, mapped.text
    item = client.post('/api/bank-inbox/ingest', json=alert()).json()['id']
    path = f"/api/bank-inbox/{item}/approve?space_id={ids['space']}"
    payload = transaction(ids['wallet'], amount='6.750', description='Talabat', date='2026-10-08T12:00:00+03:00')
    wrong = client.post(path, json={**payload, 'wallet_id': ids['private']})
    assert wrong.status_code == 400, wrong.text
    with Session(engine) as db:
        assert db.get(BankCandidate, item).status == 'pending'
    result = client.post(path, json=payload)
    assert result.status_code == 200, result.text
    assert client.post(path, json=payload).json()['transaction_id'] == result.json()['transaction_id']
    with Session(engine) as db:
        row = db.get(Transaction, result.json()['transaction_id'])
        assert row.user_id == ids['owner'] and row.recorded_by_id == ids['member']
        assert db.get(BankCandidate, item).status == 'approved'
        assert db.query(BankMerchantMemory).count() == 1


def test_viewer_revoked_mapping_and_foreign_space_rejected(spaces):
    client, _, actor, ids = spaces
    actor['id'] = ids['member']
    assert client.put('/api/bank-inbox/mappings', json={'source_package': 'test.bank', 'wallet_id': ids['wallet']}).status_code == 200
    old_item = client.post('/api/bank-inbox/ingest', json=alert()).json()['id']
    actor['id'] = ids['owner']
    client.put(f"/api/spaces/{ids['space']}/members", json={'email': 'omarsolanki35@gmail.com', 'role': 'view'})
    actor['id'] = ids['member']
    assert client.put('/api/bank-inbox/mappings', json={'source_package': 'test.bank', 'wallet_id': ids['wallet']}).status_code == 403
    assert client.post(f"/api/bank-inbox/{old_item}/approve?space_id={ids['space']}", json=transaction(ids['wallet'])).status_code == 403
    fallback = client.post('/api/bank-inbox/ingest', json=alert(content_hash='d'*64)).json()
    assert fallback['space_id'] is None
    assert client.get('/api/bank-inbox?space_id=personal').json()['total'] == 1
    actor['id'] = ids['outsider']
    assert client.get(f"/api/bank-inbox?space_id={ids['space']}").status_code == 403
    assert client.put('/api/bank-inbox/mappings', json={'source_package': 'test.bank', 'wallet_id': ids['private']}).status_code == 403


def test_ignore_restore_move_and_duplicates_require_explicit_override(spaces):
    client, _, _, ids = spaces
    item = client.post('/api/bank-inbox/ingest', json=alert()).json()['id']
    assert client.post(f'/api/bank-inbox/{item}/ignore?space_id=personal').status_code == 200
    assert client.get('/api/bank-inbox?status=ignored').json()['total'] == 1
    assert client.post(f'/api/bank-inbox/{item}/restore?space_id=personal').status_code == 200
    assert client.post(f'/api/bank-inbox/{item}/route', json={'wallet_id': ids['wallet']}).status_code == 200
    path = f"/api/bank-inbox/{item}/approve?space_id={ids['space']}"
    payload = transaction(ids['wallet'], amount='6.750', date='2026-10-08T12:00:00+03:00')
    assert client.post(f"/api/transactions?space_id={ids['space']}", json=payload).status_code == 201
    assert client.post(path, json=payload).status_code == 409
    assert client.post(path, json={**payload, 'add_anyway': True}).status_code == 200


def test_currency_security_precision_and_income_month(spaces):
    client, _, _, ids = spaces
    for changes in [{'merchant': 'OTP 12345'}, {'merchant': '4111111111111111'}, {'reasons': ['Raw private message']}, {'amount': '1.0001'}]:
        assert client.post('/api/bank-inbox/ingest', json=alert(**changes)).status_code == 422
    item = client.post('/api/bank-inbox/ingest', json=alert(currency='USD')).json()['id']
    assert client.post(f'/api/bank-inbox/{item}/approve?space_id=personal', json=transaction(ids['private'])).status_code == 422
    income = client.post('/api/bank-inbox/ingest', json=alert(content_hash='b'*64, transaction_type='income')).json()['id']
    payload = transaction(ids['private'], type='income')
    assert client.post(f'/api/bank-inbox/{income}/approve?space_id=personal', json=payload).status_code == 422
    assert client.post(f'/api/bank-inbox/{income}/approve?space_id=personal', json={**payload, 'reporting_month': '2026-10'}).status_code == 200


def test_refund_and_atm_use_existing_credit_and_transfer_semantics(spaces):
    client, engine, _, ids = spaces
    refund = client.post('/api/bank-inbox/ingest', json=alert(transaction_type='refund')).json()['id']
    path = f'/api/bank-inbox/{refund}/approve?space_id=personal'
    assert client.post(path, json=transaction(ids['private'])).status_code == 422
    assert client.post(path, json=transaction(ids['private'], type='income', reporting_month='2026-10')).status_code == 200
    atm = client.post('/api/bank-inbox/ingest', json=alert(transaction_type='withdrawal', content_hash='c'*64)).json()['id']
    cash = client.post('/api/wallets?space_id=personal', json={'name': 'Cash test', 'type': 'cash', 'initial_balance': 0}).json()['id']
    result = client.post(f'/api/bank-inbox/{atm}/approve?space_id=personal', json=transaction(ids['private'], type='transfer', transfer_wallet_id=cash))
    assert result.status_code == 200, result.text
    with Session(engine) as db:
        assert db.get(Transaction, result.json()['transaction_id']).type == 'transfer'
