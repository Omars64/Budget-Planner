"""Destructive endpoint coverage using only FK-enabled synthetic storage."""
from datetime import date
import hashlib
import json

import pytest
from sqlalchemy import Column, ForeignKey, Integer, Table, event
from sqlalchemy.orm import Session

from test_spaces import spaces  # shared isolated fixture, never application storage
from api import models as m
from api.ai_models import AIChat, AITurn, AIAction
from api.spaces import migrate_shared_wallets
from api.update_push import ScheduledPush, UpdatePushDevice, UpcomingPushReceipt


def delete(client, ids, body=None):
    return client.request('DELETE', f"/api/spaces/{ids['space']}",
                          json={'confirmation_name': 'Home Expense'} if body is None else body)


@pytest.mark.parametrize('body', [{}, {'confirmation_name': None}, {'confirmation_name': 123},
    {'confirmation_name': []}, {'confirmation_name': ''},
    {'confirmation_name': 'Home Expense', 'delete_all': True}])
def test_strict_body(spaces, body):
    client, engine, actor, ids = spaces
    assert delete(client, ids, body).status_code == 422
    with Session(engine) as db:
        assert db.get(m.Space, ids['space'])
        assert db.query(m.RecoveryPoint).count() == 0


@pytest.mark.parametrize('name', ['home expense', 'Home Expense ', ' Home Expense', 'Old name'])
def test_exact_current_name(spaces, name):
    client, engine, actor, ids = spaces
    assert delete(client, ids, {'confirmation_name': name}).status_code == 409
    with Session(engine) as db:
        assert db.get(m.Transaction, ids['tx'])
        assert db.query(m.RecoveryPoint).count() == 0


@pytest.mark.parametrize('role', ['view', 'edit', 'add', 'admin'])
def test_nonowner_including_global_admin_denied(spaces, role):
    client, engine, actor, ids = spaces
    with Session(engine) as db:
        if role == 'admin':
            user = db.get(m.User, ids['outsider']); user.role = 'admin'
            actor['id'] = user.id
        else:
            db.query(m.SpaceMember).one().role = role
            actor['id'] = ids['member']
        db.commit()
    assert delete(client, ids).status_code == 403
    with Session(engine) as db:
        assert db.get(m.Space, ids['space'])
        assert db.query(m.RecoveryPoint).count() == 0


def seed_linked(engine, ids):
    with Session(engine) as db:
        other = m.Space(owner_id=ids['owner'], name='Keep')
        db.add(other); db.flush()
        wallet = m.Wallet(user_id=ids['owner'], space_id=other.id, name='Keep')
        folder = m.NoteFolder(user_id=ids['owner'], space_id=ids['space'], name='Delete')
        db.add_all([wallet, folder]); db.flush()
        note = m.Note(user_id=ids['owner'], space_id=ids['space'], folder_id=folder.id, title='Delete')
        db.add(note); db.flush()
        db.add_all([
            m.NoteRevision(note_id=note.id, title='Old', content='Old', version=1),
            m.NoteShare(note_id=note.id, member_id=ids['member']),
            m.WalletBalanceCheck(wallet_id=ids['wallet'], checked_by_id=ids['member'], checked_by_name='Member', expected_balance=1, observed_balance=1, currency='KWD'),
            m.Goal(user_id=ids['owner'], space_id=ids['space'], name='Delete', target_amount=10),
            m.Debt(user_id=ids['owner'], space_id=ids['space'], name='Delete', principal=10, remaining=10),
            m.Budget(user_id=ids['owner'], space_id=ids['space'], name='Delete', limit_amount=10, start_date=date.today()),
            m.AppSetting(user_id=ids['owner'], key=f"cash_flow_space_{ids['space']}_v1", value=json.dumps({'revision': 0, 'goal_reserve':'0', 'buffer':'0', 'bills':[]})),
            m.WalletShare(owner_id=ids['owner'], wallet_id=wallet.id, invitee_email='keep@example.com'),
            m.BankSourceMapping(user_id=ids['member'], source_package='synthetic', account_last4='1234', wallet_id=ids['wallet']),
        ])
        tx = db.get(m.Transaction, ids['tx'])
        db.add(m.Transaction(user_id=ids['owner'], wallet_id=ids['wallet'], type='expense', amount=1, description='Child', recurring_parent_id=tx.id))
        db.add(m.BankCandidate(user_id=ids['member'], space_id=ids['space'], content_hash='x', source_package='synthetic', source_app='Synthetic', transaction_type='expense', amount=1, currency='KWD', merchant='Synthetic', occurred_at=tx.date, confidence=1, wallet_id=ids['wallet'], transaction_id=tx.id))
        device = UpdatePushDevice(id='device', user_id=ids['member'], platform='browser', payload='unused', installed_version='test')
        db.add(device); db.flush()
        plan = db.query(m.PlannedTransaction).one()
        db.add(ScheduledPush(plan_id=plan.id, device_id=device.id))
        occurrence = hashlib.sha256(f'{plan.id}:{plan.due_at.isoformat()}'.encode()).hexdigest()
        db.add_all([UpcomingPushReceipt(device_id=device.id, occurrence=occurrence), UpcomingPushReceipt(device_id=device.id, occurrence='keep')])
        chat = AIChat(id='chat', user_id=ids['member'], scope='shared', wallet_id=ids['wallet'], month='2026-11')
        db.add(chat); db.flush()
        turn = AITurn(id='turn', chat_id=chat.id, request_id='request', question='Keep history', run_token='token', note_id=note.id)
        db.add(turn); db.flush()
        db.add(AIAction(id='action', turn_id=turn.id, kind='transaction', operation='update', target_id=tx.id, title='Old action', payload='{}'))
        db.commit()
        return other.id, wallet.id


def test_deletes_only_space_and_keeps_recovery_and_outside_data(spaces):
    client, engine, actor, ids = spaces
    other, wallet = seed_linked(engine, ids)
    response = delete(client, ids)
    assert response.status_code == 204, response.text
    assert response.content == b''
    with Session(engine) as db:
        assert db.get(m.Space, ids['space']) is None
        assert db.get(m.Space, other)
        assert db.get(m.Wallet, wallet)
        assert db.get(m.Wallet, ids['private'])
        assert db.query(m.WalletShare).one().wallet_id == wallet
        assert db.query(m.User).count() == 3
        for model in (m.Transaction, m.TransactionReceipt, m.PlannedTransaction, m.WalletBalanceCheck,
                      m.Budget, m.Goal, m.Debt, m.Note, m.NoteFolder, m.NoteShare, m.NoteRevision,
                      m.BankCandidate, m.BankSourceMapping, m.SpaceMember, ScheduledPush):
            assert db.query(model).count() == 0, model.__name__
        assert db.query(UpcomingPushReceipt).one().occurrence == 'keep'
        assert db.get(UpdatePushDevice, 'device')
        assert db.get(AIChat, 'chat').scope == 'general'
        assert db.get(AIChat, 'chat').wallet_id is None
        assert db.get(AITurn, 'turn').question == 'Keep history'
        assert db.get(AITurn, 'turn').note_id is None
        assert db.get(AIAction, 'action').status == 'expired'
        recovery = json.loads(db.query(m.RecoveryPoint).one().payload)
        assert {w['id'] for w in recovery['wallets']} == {wallet, ids['wallet'], ids['private']}
        assert recovery['receipts'][0]['name'] == 'Kept receipt'
        assert recovery['spaces']
        assert db.query(m.AppSetting).count() == 0
    # A retry cannot delete another space; migration has no surviving shared
    # personal source wallet from which to recreate the deleted Home Expense.
    assert delete(client, ids).status_code == 403
    with engine.begin() as connection:
        migrate_shared_wallets(connection)
        migrate_shared_wallets(connection)
    with Session(engine) as db:
        assert [s.id for s in db.query(m.Space)] == [other]


@pytest.mark.parametrize('kind', ['transfer_out', 'transfer_in', 'category', 'folder', 'recurring', 'posted'])
def test_cross_scope_references_fail_without_mutation(spaces, kind):
    client, engine, actor, ids = spaces
    with Session(engine) as db:
        if kind.startswith('transfer'):
            tx = db.get(m.Transaction, ids['tx'])
            tx.type = 'transfer'
            tx.wallet_id, tx.transfer_wallet_id = ((ids['wallet'], ids['private']) if kind == 'transfer_out' else (ids['private'], ids['wallet']))
        elif kind == 'category':
            category = db.query(m.Category).filter_by(space_id=ids['space']).first()
            db.add(m.Budget(user_id=ids['owner'], name='Keep', category_id=category.id, limit_amount=10, start_date=date.today()))
        elif kind == 'folder':
            folder = m.NoteFolder(user_id=ids['owner'], space_id=ids['space'], name='Delete')
            db.add(folder); db.flush()
            db.add(m.Note(user_id=ids['owner'], folder_id=folder.id, title='Keep'))
        elif kind == 'recurring':
            db.add(m.Transaction(user_id=ids['owner'], wallet_id=ids['private'], type='expense', amount=1, description='Keep', recurring_parent_id=ids['tx']))
        else:
            db.add(m.PlannedTransaction(owner_id=ids['owner'], created_by_id=ids['owner'], wallet_id=ids['private'], type='expense', amount=1, description='Keep', due_at=db.get(m.Transaction, ids['tx']).date, posted_transaction_id=ids['tx']))
        db.commit()
    assert delete(client, ids).status_code == 409
    with Session(engine) as db:
        assert db.get(m.Space, ids['space'])
        assert db.get(m.Transaction, ids['tx'])
        assert db.query(m.RecoveryPoint).count() == 0


def test_failure_after_deletes_rolls_back_everything(spaces):
    client, engine, actor, ids = spaces
    def fail(connection, cursor, statement, parameters, context, executemany):
        if statement.startswith('DELETE FROM spaces '):
            raise RuntimeError('synthetic failure at final deletion')
    event.listen(engine, 'before_cursor_execute', fail)
    try:
        assert delete(client, ids).status_code == 500
    finally:
        event.remove(engine, 'before_cursor_execute', fail)
    with Session(engine) as db:
        assert db.get(m.Space, ids['space'])
        assert db.get(m.Transaction, ids['tx'])
        assert db.get(m.TransactionReceipt, ids['tx'])
        assert db.query(m.WalletShare).count() == 1
        assert db.query(m.RecoveryPoint).count() == 0


def test_personal_other_space_and_externally_shared_records_unchanged(spaces):
    client, engine, actor, ids = spaces
    kept = []
    with Session(engine) as db:
        other = m.Space(owner_id=ids['owner'], name='Other')
        foreign = m.Space(owner_id=ids['outsider'], name='External')
        db.add_all([other, foreign]); db.flush()
        for owner, scope in [(ids['owner'], None), (ids['owner'], other.id), (ids['outsider'], foreign.id)]:
            wallet = m.Wallet(user_id=owner, space_id=scope, name='Keep')
            category = m.Category(user_id=owner, space_id=scope, name='Keep', kind='expense')
            folder = m.NoteFolder(user_id=owner, space_id=scope, name='Keep')
            db.add_all([wallet, category, folder]); db.flush()
            tx = m.Transaction(user_id=owner, wallet_id=wallet.id, category_id=category.id, type='expense', amount=1, description='Keep')
            note = m.Note(user_id=owner, space_id=scope, folder_id=folder.id, title='Keep')
            db.add_all([tx, note]); db.flush()
            rows = [wallet, category, folder, tx, note,
                m.TransactionReceipt(transaction_id=tx.id, name='Keep', image='Keep'),
                m.PlannedTransaction(owner_id=owner, created_by_id=owner, wallet_id=wallet.id, type='expense', amount=1, due_at=tx.date, description='Keep'),
                m.Budget(user_id=owner, space_id=scope, category_id=category.id, name='Keep', limit_amount=10, start_date=date.today()),
                m.Goal(user_id=owner, space_id=scope, name='Keep', target_amount=10),
                m.Debt(user_id=owner, space_id=scope, name='Keep', principal=10, remaining=10),
                m.NoteShare(note_id=note.id, member_id=ids['member']),
                m.WalletShare(owner_id=owner, wallet_id=wallet.id, invitee_email='keep@example.com')]
            db.add_all(rows); db.flush()
            kept.extend((type(row), tuple(getattr(row, c.name) for c in row.__table__.primary_key),
                         {c.name: getattr(row, c.name) for c in row.__table__.columns}) for row in rows)
        db.commit()
    assert delete(client, ids).status_code == 204
    with Session(engine) as db:
        for model, ident, before in kept:
            row = db.get(model, ident)
            assert row is not None
            assert {c.name: getattr(row, c.name) for c in row.__table__.columns} == before


def test_deleted_scope_rejects_reads_and_writes(spaces):
    client, engine, actor, ids = spaces
    assert delete(client, ids).status_code == 204
    for actor_id in (ids['owner'], ids['member']):
        actor['id'] = actor_id
        for path in ('wallets', 'transactions', 'planned-transactions', 'bank-inbox'):
            response = client.get(f"/api/{path}?space_id={ids['space']}")
            assert response.status_code in (403, 404), (path, response.text)
        response = client.post(f"/api/wallets?space_id={ids['space']}", json={'name': 'Stale', 'type': 'cash', 'initial_balance': 0})
        assert response.status_code in (403, 404)
    with Session(engine) as db:
        assert db.query(m.Wallet).count() == 1


def test_migrated_ledger_personal_categories_are_preserved(spaces):
    client, engine, actor, ids = spaces
    with Session(engine) as db:
        category = m.Category(user_id=ids['owner'], name='Legacy personal', kind='expense')
        db.add(category); db.flush(); category_id = category.id
        db.get(m.Transaction, ids['tx']).category_id = category.id
        db.query(m.PlannedTransaction).one().category_id = category.id
        personal = m.Transaction(user_id=ids['owner'], wallet_id=ids['private'], category_id=category.id,
                                 type='expense', amount=1, description='Keep personal')
        db.add(personal); db.flush(); personal_id = personal.id
        db.commit()
    assert delete(client, ids).status_code == 204
    with Session(engine) as db:
        assert db.get(m.Category, category_id).space_id is None
        assert db.get(m.Transaction, personal_id).category_id == category_id
        assert db.get(m.Transaction, ids['tx']) is None


def test_unrelated_malformed_json_does_not_block_deletion(spaces):
    client, engine, actor, ids = spaces
    with Session(engine) as db:
        db.add(m.AppSetting(user_id=ids['outsider'], key='cash_flow_v1', value='bad json'))
        db.add(AIChat(id='unrelated', user_id=ids['outsider'], scope='general', month='2026-11'))
        db.flush()
        db.add(AITurn(id='unrelated-turn', chat_id='unrelated', request_id='r', question='Keep', run_token='t'))
        db.flush()
        db.add(AIAction(id='unrelated-action', turn_id='unrelated-turn', kind='note', operation='create', title='Keep', payload='bad json', before='bad json'))
        db.commit()
    assert delete(client, ids).status_code == 204
    with Session(engine) as db:
        assert db.get(AIAction, 'unrelated-action').payload == 'bad json'
        assert db.get(m.AppSetting, (ids['outsider'], 'cash_flow_v1')).value == 'bad json'


def test_stale_ai_context_cannot_be_saved_after_deletion(spaces):
    from fastapi import HTTPException
    client, engine, actor, ids = spaces
    assert delete(client, ids).status_code == 204
    with Session(engine) as db:
        db.add(AIChat(id='stale', user_id=ids['owner'], scope='personal', wallet_id=ids['wallet'], month='2026-11'))
        with pytest.raises(HTTPException) as error:
            db.commit()
        assert error.value.status_code == 409
        db.rollback()
        assert db.get(AIChat, 'stale') is None


def test_large_space_uses_bounded_bind_batches(spaces):
    client, engine, actor, ids = spaces
    with Session(engine) as db:
        # More than two batches, including self-referential ledger children.
        db.add_all([m.Transaction(user_id=ids['owner'], wallet_id=ids['wallet'], type='expense',
            amount=1, description='Synthetic large', recurring_parent_id=ids['tx']) for _ in range(1001)])
        db.commit()
    parameter_counts = []
    def count(connection, cursor, statement, parameters, context, executemany):
        if statement.startswith(('DELETE FROM', 'UPDATE transactions', 'SELECT transaction_receipts')):
            parameter_counts.append(len(parameters))
    event.listen(engine, 'before_cursor_execute', count)
    try:
        response = delete(client, ids)
        assert response.status_code == 204, response.text
    finally:
        event.remove(engine, 'before_cursor_execute', count)
    assert max(parameter_counts) <= 801
    with Session(engine) as db:
        assert db.query(m.Transaction).count() == 0


def test_unexpected_cascade_foreign_key_fails_closed(spaces):
    from api.database import Base
    client, engine, actor, ids = spaces
    probe = Table('space_deletion_test_probe', Base.metadata,
                  Column('id', Integer, primary_key=True),
                  Column('wallet_id', Integer, ForeignKey('wallets.id', ondelete='CASCADE')))
    try:
        probe.create(engine)
        with engine.begin() as connection:
            connection.execute(probe.insert().values(id=1, wallet_id=ids['wallet']))
        assert delete(client, ids).status_code == 409
        with engine.connect() as connection:
            assert connection.execute(probe.select()).one().wallet_id == ids['wallet']
        with Session(engine) as db:
            assert db.get(m.Space, ids['space'])
            assert db.query(m.RecoveryPoint).count() == 0
    finally:
        probe.drop(engine)
        Base.metadata.remove(probe)
