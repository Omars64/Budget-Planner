"""Small cross-feature journeys using real password sign-in and disposable storage."""
from datetime import timedelta
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker


@pytest.fixture
def journey(tmp_path, monkeypatch):
    from api import database, index
    from api.app import app
    from api.models import User

    def forbidden(*args, **kwargs):
        raise AssertionError('Journey attempted global storage or external network')

    # conftest selects synthetic storage before imports; also fail closed if any
    # route bypasses the request/session-factory bindings below.
    event.listen(database.engine, 'checkout', forbidden)
    event.listen(database.engine, 'connect', forbidden)
    monkeypatch.setattr('socket.create_connection', forbidden)
    engine = create_engine('sqlite:///' + (tmp_path / 'journey.db').as_posix(),
                           connect_args={'check_same_thread': False})

    @event.listens_for(engine, 'connect')
    def constraints(connection, _):
        connection.execute('PRAGMA foreign_keys=ON')

    database.Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    monkeypatch.setattr(index, 'SessionLocal', factory)
    monkeypatch.setattr(database, 'SessionLocal', factory)
    monkeypatch.setenv('SCHEDULE_RUNNER_SECRET', 'synthetic-journey-runner')
    monkeypatch.setattr(app.state, 'storage_ready', True, raising=False)
    password = 'SyntheticJourney!2026'
    with Session(engine) as db:
        digest = index.hash_password(password)
        users = [User(username=name, email=f'{name}@journey.test', password_hash=digest)
                 for name in ('owner', 'manager', 'viewer', 'outsider')]
        db.add_all(users)
        db.commit()
        ids = {u.username: u.id for u in users}

    def isolated_db():
        with factory() as db:
            yield db

    previous = app.dependency_overrides.copy()
    app.dependency_overrides.clear()
    app.dependency_overrides[database.get_db] = isolated_db
    client = TestClient(app)  # Never enter lifespan: no seed, startup or background jobs.

    def request(method, path, actor='owner', expected=200, **kwargs):
        headers = {**tokens[actor], **kwargs.pop('headers', {})}
        response = client.request(method, path, headers=headers, **kwargs)
        assert response.status_code == expected, response.text
        return response.json() if response.content else None

    try:
        tokens = {}
        assert client.get('/api/spaces').status_code == 401
        for name in ids:
            login = client.post('/api/auth/login', json={
                'email': f'{name}@journey.test', 'password': password})
            assert login.status_code == 200, login.text
            tokens[name] = {'Authorization': 'Bearer ' + login.json()['token']}
        space = request('POST', '/api/spaces', expected=201, json={'name': 'Journey home'})['id']
        scope = f'?space_id={space}'
        for name, role in [('manager', 'edit'), ('viewer', 'view')]:
            request('PUT', f'/api/spaces/{space}/members',
                    json={'email': f'{name}@journey.test', 'role': role})
        wallet = request('POST', '/api/wallets' + scope, expected=201,
                         json={'name': 'Journey cash', 'type': 'cash', 'initial_balance': 100})['id']
        yield SimpleNamespace(call=request, engine=engine, ids=ids, space=space,
                              scope=scope, wallet=wallet, password=password)
    finally:
        client.close()
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous)
        engine.dispose()
        event.remove(database.engine, 'checkout', forbidden)
        event.remove(database.engine, 'connect', forbidden)


def entry(j, **changes):
    from api.timekeeping import now
    return {'wallet_id': j.wallet, 'type': 'expense', 'amount': '2.250',
            'description': 'Journey groceries', 'date': now().isoformat(), **changes}


def expenses(j, actor='owner'):
    return [row for row in j.call('GET', '/api/transactions' + j.scope, actor=actor)
            if row['type'] == 'expense']


def test_signed_in_roles_edit_delete_and_live_membership_revocation(journey):
    j = journey
    path = '/api/transactions' + j.scope
    owner = j.call('POST', path, expected=201, json=entry(j))
    manager = j.call('POST', path, actor='manager', expected=201,
                     json=entry(j, description='Manager purchase'))
    for actor, row in [('manager', owner), ('owner', manager)]:
        updated = j.call('PUT', f"/api/transactions/{row['id']}" + j.scope,
                         actor=actor, headers={'If-Match': row['revision']},
                         json=entry(j, amount='3.125', description='Corrected'))
        assert updated['description'] == 'Corrected'
        j.call('PUT', f"/api/transactions/{row['id']}" + j.scope, actor=actor,
               expected=409, headers={'If-Match': row['revision']}, json=entry(j))
    visible = expenses(j, 'viewer')
    assert {row['id'] for row in visible} == {owner['id'], manager['id']}
    j.call('POST', path, actor='viewer', expected=403, json=entry(j))
    for row in visible:
        endpoint = f"/api/transactions/{row['id']}" + j.scope
        j.call('PUT', endpoint, actor='viewer', expected=403,
               headers={'If-Match': row['revision']}, json=entry(j))
        j.call('DELETE', endpoint, actor='viewer', expected=403)
    j.call('DELETE', f'/api/spaces/{j.space}/members/manager@journey.test')
    j.call('GET', path, actor='manager', expected=403)
    j.call('POST', path, actor='manager', expected=403, json=entry(j))
    for method in ('PUT', 'DELETE'):
        kwargs = {'json': entry(j), 'headers': {'If-Match': visible[0]['revision']}} if method == 'PUT' else {}
        j.call(method, f"/api/transactions/{visible[0]['id']}" + j.scope,
               actor='manager', expected=403, **kwargs)
    assert j.call('GET', '/api/spaces', actor='manager') == []
    j.call('GET', path, actor='outsider', expected=403)
    # Regrant with the same signed-in session: authorization is live both ways.
    j.call('PUT', f'/api/spaces/{j.space}/members',
           json={'email': 'manager@journey.test', 'role': 'edit'})
    for actor, row in [('manager', owner), ('owner', manager)]:
        j.call('DELETE', f"/api/transactions/{row['id']}" + j.scope, actor=actor, expected=204)
    assert expenses(j) == []
    assert Decimal(str(j.call('GET', '/api/wallets' + j.scope)[0]['balance'])) == Decimal('100')


def test_signed_in_schedule_retry_restore_and_retry_again(journey):
    from api.models import PlannedTransaction, Transaction
    from api.timekeeping import now
    j = journey
    plan = j.call('POST', '/api/planned-transactions' + j.scope, actor='manager', expected=201,
                  json={'status': 'scheduled', 'transaction': entry(j, date=(now()+timedelta(days=2)).isoformat())})
    assert expenses(j) == []
    with Session(j.engine) as db:
        db.get(PlannedTransaction, plan['id']).due_at = now()-timedelta(minutes=1)
        db.commit()
    runner = '/api/maintenance/scheduled-transactions'
    j.call('POST', runner, expected=401)
    for expected in (1, 0):
        result = j.call('POST', runner, headers={'Authorization': 'Bearer synthetic-journey-runner'})
        assert result['scheduled_transactions_posted'] == expected
    with Session(j.engine) as db:
        tx = db.query(Transaction).filter_by(is_opening_balance=False).one()
        assert (tx.user_id, tx.recorded_by_id, tx.amount) == (j.ids['owner'], j.ids['manager'], Decimal('2.250'))
        assert db.get(PlannedTransaction, plan['id']).posted_transaction_id == tx.id
    backup = j.call('GET', '/api/backup')
    for _ in range(2):
        j.call('POST', '/api/account/confirm', json={'password': j.password})
        j.call('POST', '/api/backup/restore', json=backup)
        result = j.call('POST', runner, headers={'Authorization': 'Bearer synthetic-journey-runner'})
        assert result['scheduled_transactions_posted'] == 0
        wallets = j.call('GET', '/api/wallets' + j.scope, actor='viewer')
        assert Decimal(str(wallets[0]['balance'])) == Decimal('97.750')
        rows = expenses(j)
        assert len(rows) == 1 and Decimal(str(rows[0]['amount'])) == Decimal('2.250')
        with Session(j.engine) as db:
            restored = db.query(PlannedTransaction).one()
            assert restored.status == 'posted' and restored.posted_transaction_id == rows[0]['id']


def test_pending_schedule_cannot_post_after_creator_membership_revoked(journey):
    from api.models import PlannedTransaction, Transaction
    from api.timekeeping import now
    j = journey
    plan = j.call('POST', '/api/planned-transactions' + j.scope, actor='manager', expected=201,
                  json={'status': 'scheduled', 'transaction': entry(j, date=(now()+timedelta(days=2)).isoformat())})
    j.call('DELETE', f'/api/spaces/{j.space}/members/manager@journey.test')
    with Session(j.engine) as db:
        db.get(PlannedTransaction, plan['id']).due_at = now()-timedelta(minutes=1)
        db.commit()
    for _ in range(2):
        result = j.call('POST', '/api/maintenance/scheduled-transactions',
                        headers={'Authorization': 'Bearer synthetic-journey-runner'})
        assert result['scheduled_transactions_posted'] == 0
    with Session(j.engine) as db:
        assert db.get(PlannedTransaction, plan['id']).status == 'failed'
        assert db.query(Transaction).filter_by(is_opening_balance=False).count() == 0
    assert Decimal(str(j.call('GET', '/api/wallets' + j.scope)[0]['balance'])) == Decimal('100')
