from datetime import date
from api import index
from api.models import Transaction, Budget
from tests.test_planned_transactions import workspace


def test_monthly_rule_rolls_over_without_duplicating_budgets_or_changing_records(workspace, monkeypatch):
    client, db, actor, owner, member, wallet = workspace
    current = {'day':date(2026,12,31)}
    monkeypatch.setattr(index, 'ledger_today',lambda:current['day'])
    for month, amount in [('2026-12',6),('2027-01',2)]:
        result=client.post('/api/transactions?space_id=personal',json={'wallet_id':wallet.id,'type':'expense','amount':amount,'description':'Transport','date':month+'-15T12:00:00+03:00','reporting_month':month})
        assert result.status_code == 201, result.text
    base={'name':'Monthly transport','limit_amount':8,'period':'monthly','start_date':'2026-12-01'}
    recurring=client.post('/api/budgets?space_id=personal',json=base)
    assert recurring.status_code == 201, recurring.text
    recurring_id=recurring.json()['id']
    pinned=client.post('/api/budgets?space_id=personal',json={**base,'name':'December only','reporting_month':'2026-12'}).json()['id']
    before=[(row.id,row.amount,row.reporting_month) for row in db.query(Transaction).order_by(Transaction.id)]
    read=lambda:{row['id']:row for row in client.get('/api/budgets?space_id=personal').json()}
    assert read()[recurring_id]['spent'] == 6
    current['day']=date(2027,1,1)
    january=read()
    assert january[recurring_id]['spent'] == 2 and january[recurring_id]['remaining'] == 6
    assert january[recurring_id]['records_month'] == '2027-01'
    assert january[pinned]['spent'] == 6 and january[pinned]['records_month'] == '2026-12'
    assert db.query(Budget).count() == 2
    assert [(row.id,row.amount,row.reporting_month) for row in db.query(Transaction).order_by(Transaction.id)] == before
