"""Synthetic account archives and physical SQLite recovery, with no live connections."""
import base64
import copy
import io
import json
from datetime import date, datetime
from decimal import Decimal
from types import SimpleNamespace

import pytest


AT = datetime(2026, 10, 11, 12)


@pytest.fixture
def rehearsal(monkeypatch):
    from sqlalchemy import create_engine, event
    from sqlalchemy.orm import Session
    from sqlalchemy.pool import StaticPool
    from api import database

    def forbidden_connection(*_):
        raise AssertionError('Recovery rehearsal attempted the configured database')

    event.listen(database.engine, 'connect', forbidden_connection)
    event.listen(database.engine, 'checkout', forbidden_connection)
    monkeypatch.setattr('socket.create_connection', forbidden_connection)
    try:
        from fastapi import Depends
        from fastapi.testclient import TestClient
        from api.app import app
        from api.index import current_user
        from api import models as m
        from PIL import Image

        engine = create_engine('sqlite://', connect_args={'check_same_thread': False},
                               poolclass=StaticPool)
        @event.listens_for(engine, 'connect')
        def enable_constraints(connection, _):
            connection.execute('PRAGMA foreign_keys=ON')

        database.Base.metadata.create_all(engine)
        image = io.BytesIO()
        Image.new('RGB', (2, 2), (20, 150, 80)).save(image, format='PNG')
        receipt = 'data:image/png;base64,' + base64.b64encode(image.getvalue()).decode()
        attachment = 'data:application/pdf;base64,' + base64.b64encode(b'%PDF-1.4\nsynthetic attachment\n%%EOF').decode()
        with Session(engine) as db:
            users = [m.User(username=name, email=f'{name}@rehearsal.test', password_hash='synthetic-hash')
                     for name in ('owner', 'target', 'viewer', 'adder', 'editor', 'outsider')]
            db.add_all(users); db.flush()
            ids = {u.username: u.id for u in users}
            owner = ids['owner']
            space = m.Space(owner_id=owner, name='Synthetic home', color='green', currency='KWD')
            db.add(space); db.flush()
            for name, role in [('viewer', 'view'), ('adder', 'add'), ('editor', 'edit')]:
                db.add(m.SpaceMember(space_id=space.id, email=f'{name}@rehearsal.test',
                                    member_user_id=ids[name], role=role))
            db.add(m.SpaceMember(space_id=space.id, email='pending@rehearsal.test', role='view'))
            wallets = [m.Wallet(user_id=owner, name=name, initial_balance=Decimal(amount),
                                space_id=space.id if name == 'Shared' else None, created_at=AT)
                       for name, amount in [('Cash', '100.001'), ('Bank', '20.002'), ('Shared', '50.003')]]
            sentinel = m.Wallet(user_id=ids['outsider'], name='Untouched', initial_balance=Decimal('77.777'))
            db.add_all(wallets + [sentinel]); db.flush()
            category = m.Category(user_id=owner, name='Synthetic bills', kind='expense')
            db.add(category); db.flush()
            rows = [m.Transaction(user_id=owner, wallet_id=wallets[0].id, category_id=category.id,
                                  type='expense', amount=Decimal('3.125'), description='Parent',
                                  date=AT, reporting_month='2026-11', recurring_frequency='monthly',
                                  recurring_until=date(2027, 1, 11)),
                    m.Transaction(user_id=owner, wallet_id=wallets[0].id, transfer_wallet_id=wallets[1].id,
                                  type='transfer', amount=Decimal('7.007'), description='Transfer', date=AT),
                    m.Transaction(user_id=owner, wallet_id=wallets[2].id, type='expense',
                                  amount=Decimal('1.001'), description='Shared expense', date=AT,
                                  recorded_by_id=ids['editor'])]
            db.add_all(rows); db.flush()
            child = m.Transaction(user_id=owner, wallet_id=wallets[0].id, category_id=category.id,
                                  type='expense', amount=Decimal('3.125'), description='Child', date=AT,
                                  recurring_parent_id=rows[0].id)
            db.add(child)
            db.add(m.TransactionReceipt(transaction_id=rows[0].id, name='synthetic.png', image=receipt))
            plans = []
            for status in ('planned', 'scheduled', 'posted', 'failed'):
                plan = m.PlannedTransaction(owner_id=owner, created_by_id=ids['editor'],
                    wallet_id=wallets[0].id, category_id=category.id, type='expense',
                    amount=Decimal('3.125'), description=f'Plan {status}', due_at=datetime(2027, 1, 11),
                    status=status, posted_transaction_id=rows[0].id if status == 'posted' else None,
                    reporting_month='2027-02', reminder_enabled=False)
                plans.append(plan)
            db.add_all(plans); db.flush()
            for scoped in (False, True):
                folder = m.NoteFolder(user_id=owner, name=f'Folder {scoped}',
                                      space_id=space.id if scoped else None, color='#123456')
                db.add(folder); db.flush()
                db.add(m.Note(user_id=owner, title=f'Attachment {scoped}', content='Synthetic note',
                    folder_id=folder.id, space_id=folder.space_id, pinned=True, note_type='file',
                    color='#abcdef', page_style='lined', checklist='[{"text":"Check","done":true}]',
                    attachment_name='synthetic.pdf', attachment_type='application/pdf', attachment_data=attachment))
            from api.planner import KEY
            for key, wallet, payment, plan in [(KEY, wallets[0], rows[0], plans[0]),
                    (f'cash_flow_space_{space.id}_v1', wallets[2], rows[2], None)]:
                config = {'revision': 4, 'goal_reserve': '2.001', 'buffer': '1.002', 'bills': [{
                    'id': '00000000-0000-4000-8000-000000000001', 'name': 'Synthetic bill',
                    'amount': str(payment.amount), 'wallet_id': wallet.id, 'due_at': AT.isoformat(),
                    'frequency': 'monthly', 'planned_id': plan.id if plan else None,
                    'payments': [{'occurrence': AT.isoformat(), 'transaction_id': payment.id,
                                  'amount': str(payment.amount), 'transaction_created_at': payment.created_at.isoformat()}],
                    'price_history': [{'amount': '2.000', 'changed_at': '2026-09-01T12:00:00'}]}]}
                db.add(m.AppSetting(user_id=owner, key=key, value=json.dumps(config)))
            db.add_all([m.AppSetting(user_id=owner, key='pin_hash', value='synthetic-pin'),
                        m.AppSetting(user_id=owner, key='passkey', value='synthetic-passkey'),
                        m.AppSetting(user_id=ids['target'], key='pin_hash', value='target-pin')])
            db.commit()
            space_id = space.id

        actor = {'id': owner}
        def get_db():
            with Session(engine) as db:
                yield db
        def authenticated(db=Depends(database.get_db)):
            return db.get(m.User, actor['id'])
        old_overrides = app.dependency_overrides.copy()
        monkeypatch.setattr(app.state, 'storage_ready', True, raising=False)
        monkeypatch.setattr('api.account_security.confirmed', lambda *_: None)
        monkeypatch.setattr('api.planner.now', lambda: AT)
        app.dependency_overrides[database.get_db] = get_db
        app.dependency_overrides[current_user] = authenticated
        try:
            # No context manager: deliberately never run startup/jobs/seed against global storage.
            client = TestClient(app)
            yield SimpleNamespace(client=client, engine=engine, actor=actor, ids=ids,
                                  space=space_id, receipt=receipt, attachment=attachment, m=m)
        finally:
            client.close()
            app.dependency_overrides = old_overrides
            engine.dispose()
    finally:
        event.remove(database.engine, 'connect', forbidden_connection)
        event.remove(database.engine, 'checkout', forbidden_connection)


def archive(r):
    response = r.client.get('/api/backup')
    assert response.status_code == 200, response.text
    return response.json()


def restore(r, payload):
    response = r.client.post('/api/backup/restore', json=payload)
    assert response.status_code == 200, response.text


@pytest.mark.parametrize('fresh', [False, True], ids=['same-account', 'fresh-account-id-collision'])
def test_account_restore_preserves_content_links_and_balances(rehearsal, fresh):
    from sqlalchemy.orm import Session
    from api.index import wallet_balance
    r = rehearsal
    original = archive(r)
    assert 'users' not in original and 'pin_hash' not in original['settings']
    assert 'passkey' not in original['settings']
    expected = {'Cash': Decimal('86.744'), 'Bank': Decimal('27.009'), 'Shared': Decimal('49.002')}
    if fresh:
        r.actor['id'] = r.ids['target']
    # Repeat replacement to catch duplicated openings, children, receipts and plans.
    for _ in range(2):
        restore(r, original)
        recovered = archive(r)
        with Session(r.engine) as db:
            wallets = {w.name: w for w in db.query(r.m.Wallet).filter_by(user_id=r.actor['id'])}
            assert {name: Decimal(str(wallet_balance(db, w))) for name, w in wallets.items()} == expected
            assert db.query(r.m.Wallet).filter_by(user_id=r.ids['outsider']).one().initial_balance == Decimal('77.777')
            assert db.get(r.m.AppSetting, (r.actor['id'], 'pin_hash')).value == ('target-pin' if fresh else 'synthetic-pin')
            assert db.get(r.m.User, r.actor['id']).password_hash == 'synthetic-hash'
            transactions = {t.description: t for t in db.query(r.m.Transaction).filter_by(user_id=r.actor['id'])
                            if not t.is_opening_balance}
            assert len(transactions) == 4
            assert transactions['Child'].recurring_parent_id == transactions['Parent'].id
            assert transactions['Parent'].recurring_until == date(2027, 1, 11)
            assert transactions['Parent'].reporting_month == '2026-11'
            assert transactions['Transfer'].wallet_id == wallets['Cash'].id
            assert transactions['Transfer'].transfer_wallet_id == wallets['Bank'].id
            assert transactions['Parent'].category_id == db.query(r.m.Category).filter_by(user_id=r.actor['id'], name='Synthetic bills').one().id
            assert transactions['Shared expense'].recorded_by_id is None
            receipt = db.get(r.m.TransactionReceipt, transactions['Parent'].id)
            assert (receipt.name, receipt.image) == ('synthetic.png', r.receipt)
            plans = {p.status: p for p in db.query(r.m.PlannedTransaction).filter_by(owner_id=r.actor['id'])}
            assert set(plans) == {'planned', 'scheduled', 'posted', 'failed'}
            assert plans['posted'].posted_transaction_id == transactions['Parent'].id
            assert all(p.created_by_id == r.actor['id'] and p.reporting_month == '2027-02' and not p.reminder_enabled for p in plans.values())
            notes = db.query(r.m.Note).filter_by(user_id=r.actor['id']).all()
            assert len(notes) == 2
            for note in notes:
                folder = db.get(r.m.NoteFolder, note.folder_id)
                assert folder.user_id == r.actor['id'] and folder.space_id == note.space_id
                assert (note.attachment_name, note.attachment_type, note.attachment_data) == ('synthetic.pdf', 'application/pdf', r.attachment)
                assert note.pinned and note.content == 'Synthetic note' and note.page_style == 'lined'
                assert json.loads(note.checklist) == [{'text': 'Check', 'done': True}]
            for key, value in recovered['settings'].items():
                if not key.startswith('cash_flow_'):
                    continue
                config = json.loads(value)
                bill = config['bills'][0]
                assert config['revision'] > 4 and config['goal_reserve'] == '2.001'
                assert bill['price_history'][0]['amount'] == '2.000'
                assert bill['wallet_id'] in {w.id for w in wallets.values()}
                payment = bill['payments'][0]
                tx = db.get(r.m.Transaction, payment['transaction_id'])
                assert tx.user_id == r.actor['id'] and tx.wallet_id == bill['wallet_id']
                assert payment['transaction_created_at'] == tx.created_at.isoformat()
                if bill['planned_id']:
                    assert bill['planned_id'] == plans['planned'].id
            space = db.get(r.m.Space, wallets['Shared'].space_id)
            assert space.owner_id == r.actor['id']
            if fresh:
                assert space.id != r.space
                assert db.get(r.m.Space, r.space).owner_id == r.ids['owner']
        assert len(recovered['receipts']) == 1 and len(recovered['planned_transactions']) == 4


@pytest.mark.parametrize('fresh', [False, True])
@pytest.mark.parametrize('member,can_add,can_edit', [('viewer', False, False), ('adder', True, False), ('editor', True, True), ('outsider', False, False)])
def test_restored_space_enforces_roles(rehearsal, fresh, member, can_add, can_edit):
    r = rehearsal
    payload = archive(r)
    if fresh:
        r.actor['id'] = r.ids['target']
    restore(r, payload)
    shared = next(w for w in archive(r)['wallets'] if w['name'] == 'Shared')
    r.actor['id'] = r.ids[member]
    scope = f"?space_id={shared['space_id']}"
    response = r.client.get('/api/wallets' + scope)
    assert response.status_code == (403 if member == 'outsider' else 200)
    if member != 'outsider':
        assert response.json()[0]['balance'] == 49.002
    tx = {'wallet_id': shared['id'], 'type': 'expense', 'amount': '0.001',
          'description': 'Role probe', 'date': AT.isoformat()}
    response = r.client.post('/api/transactions' + scope, json=tx)
    assert response.status_code == (201 if can_add else 403), response.text
    budget = {'name': 'Role probe', 'limit_amount': '10', 'period': 'monthly', 'start_date': '2026-10-01'}
    response = r.client.post('/api/budgets' + scope, json=budget)
    assert response.status_code == (201 if can_edit else 403), response.text


@pytest.mark.parametrize('corruption', ['wallet', 'space', 'receipt', 'planner', 'version',
                                      'duplicate', 'folder', 'cross-space-transfer', 'money'])
def test_invalid_archive_rejected_without_replacing_account(rehearsal, corruption):
    r = rehearsal
    before = archive(r)
    payload = copy.deepcopy(before)
    if corruption == 'wallet':
        payload['transactions'][0]['wallet_id'] = 999999
    elif corruption == 'space':
        payload['wallets'][0]['space_id'] = 999999
    elif corruption == 'receipt':
        payload['receipts'][0]['transaction_id'] = 999999
    elif corruption == 'planner':
        key = 'cash_flow_planner_v1'
        config = json.loads(payload['settings'][key])
        config['bills'][0]['wallet_id'] = 999999
        payload['settings'][key] = json.dumps(config)
    elif corruption == 'duplicate':
        payload['transactions'].append(copy.deepcopy(payload['transactions'][0]))
    elif corruption == 'folder':
        payload['notes'][0]['folder_id'] = 999999
    elif corruption == 'cross-space-transfer':
        transfer = next(t for t in payload['transactions'] if t['type'] == 'transfer')
        transfer['transfer_wallet_id'] = next(w['id'] for w in payload['wallets'] if w['name'] == 'Shared')
    elif corruption == 'money':
        payload['transactions'][0]['amount'] = '-0.001'
    else:
        payload['version'] = 999
    response = r.client.post('/api/backup/restore', json=payload)
    assert response.status_code == 400, response.text
    after = archive(r)
    before.pop('exported_at'); after.pop('exported_at')
    assert after == before


@pytest.mark.parametrize('aspect', ['metadata', 'members'])
def test_same_account_restore_reinstates_archived_space_membership(rehearsal, aspect):
    from sqlalchemy.orm import Session
    r = rehearsal
    payload = archive(r)
    with Session(r.engine) as db:
        space = db.get(r.m.Space, r.space)
        space.name, space.color, space.currency = 'Edited after export', 'pink', 'USD'
        db.query(r.m.SpaceMember).filter_by(space_id=r.space, email='viewer@rehearsal.test').one().role = 'edit'
        db.query(r.m.SpaceMember).filter_by(space_id=r.space, email='editor@rehearsal.test').delete()
        db.add(r.m.SpaceMember(space_id=r.space, email='outsider@rehearsal.test', member_user_id=r.ids['outsider'], role='edit'))
        db.commit()
    restore(r, payload)
    recovered = archive(r)['spaces'][0]
    if aspect == 'metadata':
        assert (recovered['name'], recovered['color'], recovered['currency']) == ('Synthetic home', 'green', 'KWD')
    else:
        assert sorted(recovered['members'], key=lambda x: x['email']) == sorted(payload['spaces'][0]['members'], key=lambda x: x['email'])


@pytest.mark.parametrize('missing_link', [None, 999999])
def test_posted_plan_without_transaction_stays_completed(rehearsal, missing_link):
    from sqlalchemy.orm import Session
    from api.planned import post_due
    r = rehearsal
    payload = archive(r)
    posted = next(p for p in payload['planned_transactions'] if p['status'] == 'posted')
    posted['posted_transaction_id'] = missing_link
    restore(r, payload)
    with Session(r.engine) as db:
        plan = db.query(r.m.PlannedTransaction).filter_by(owner_id=r.ids['owner'], status='posted').one()
        assert plan.posted_transaction_id is None
        before = db.query(r.m.Transaction).count()
        assert post_due(db) == 0
        assert db.query(r.m.Transaction).count() == before
        assert plan.status == 'posted'


def test_whole_database_sqlite_backup_preserves_every_table(rehearsal):
    import sqlite3
    r = rehearsal
    source = r.engine.raw_connection()
    recovered = sqlite3.connect(':memory:')
    try:
        source.driver_connection.backup(recovered)
        assert recovered.execute('PRAGMA integrity_check').fetchone() == ('ok',)
        assert recovered.execute('PRAGMA foreign_key_check').fetchall() == []
        names = source.cursor().execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").fetchall()
        assert names
        for (name,) in names:
            quoted = '"' + name.replace('"', '""') + '"'
            query = f'SELECT * FROM {quoted}'
            assert sorted(source.cursor().execute(query).fetchall(), key=repr) == sorted(recovered.execute(query).fetchall(), key=repr), name
        assert recovered.execute('SELECT count(*) FROM users').fetchone() == (6,)
        settings = r.m.AppSetting.__tablename__
        assert recovered.execute(f'SELECT value FROM "{settings}" WHERE key=\'passkey\'').fetchone() == ('synthetic-passkey',)
    finally:
        recovered.close()
        source.close()
