from copy import deepcopy
import pytest
from api.backup_compatibility import normalize_legacy_space_categories as normalize
from api.backup_compatibility import category_count_without_recovery_copies
from api.backup_validation import validate_archive_records


def legacy():
    return {'version':1,'settings':{},'spaces':[{'id':10,'name':'Home','members':[]}],
        'wallets':[{'id':1,'name':'Personal'},{'id':2,'name':'Home wallet','space_id':10}],
        'categories':[{'id':3,'name':'Food','kind':'expense','icon':'utensils','color':'#123456','space_id':None}],
        'transactions':[{'id':4,'wallet_id':2,'category_id':3,'type':'expense','amount':'1.125',
                         'description':'Synthetic expense','date':'2026-10-28T10:00:00'}],
        'planned_transactions':[{'id':5,'wallet_id':2,'category_id':3,'type':'expense','amount':'2.250',
                                'description':'Scheduled','due_at':'2026-11-28T10:00:00','status':'scheduled'}],
        'budgets':[{'id':6,'name':'Home budget','space_id':10,'category_id':3,'limit_amount':'10','start_date':'2026-10-01'}],
        'goals':[],'debts':[]}


def test_legacy_labels_are_scoped_in_copy_without_changing_money_or_original():
    source=legacy();before=deepcopy(source)
    normalized=normalize(source)
    assert source==before
    assert normalized['categories'][:1]==source['categories']
    copied=normalized['categories'][1]
    assert copied=={**source['categories'][0],'id':4,'space_id':10}
    for collection in ('transactions','planned_transactions','budgets'):
        assert normalized[collection][0]=={**source[collection][0],'category_id':copied['id']}
    assert normalized['recovery_compatibility']=={'legacy_space_category_links':3,'space_category_copies':1}
    validate_archive_records(normalized,('wallets','categories','transactions','planned_transactions','budgets'))
    assert normalize(normalized)==normalized


def test_exact_existing_space_category_is_reused_without_duplicates():
    source=legacy()
    source['categories'].append({**source['categories'][0],'id':8,'space_id':10})
    normalized=normalize(source)
    assert len(normalized['categories'])==2
    assert normalized['transactions'][0]['category_id']==8
    assert normalized['recovery_compatibility']['space_category_copies']==0


def test_cross_space_budget_category_stays_rejected():
    source=legacy()
    source['categories'].append({**source['categories'][0],'id':8,'space_id':11})
    source['budgets'][0]['category_id']=8
    with pytest.raises(ValueError,match='budget category workspace'):
        validate_archive_records(normalize(source),('wallets','categories','transactions','planned_transactions','budgets'))


def test_generated_copies_keep_the_original_category_budget_on_reimport():
    source=legacy()
    source['categories'].extend({'id':1000+i,'name':f'Original {i}','kind':'expense'} for i in range(499))
    assert len(source['categories'])==500
    normalized=normalize(source)
    assert len(normalized['categories'])==501
    assert category_count_without_recovery_copies(normalized)==500
    assert category_count_without_recovery_copies(normalize(normalized))==500
    normalized['recovery_compatibility']['space_category_copies']=25_000
    normalized['categories'].append({'id':99999,'name':'Another original','kind':'expense'})
    assert category_count_without_recovery_copies(normalized)==501


@pytest.mark.parametrize('defect',['other-space','kind','missing-category','missing-space','duplicate','bad-wallet-id'])
def test_normalizer_never_weakens_strict_archive_boundaries(defect):
    source=legacy()
    if defect=='other-space':source['categories'][0]['space_id']=11
    elif defect=='kind':source['categories'][0]['kind']='income'
    elif defect=='missing-category':source['transactions'][0]['category_id']=99
    elif defect=='missing-space':source['spaces']=[]
    elif defect=='duplicate':source['categories'].append(dict(source['categories'][0]))
    else:source['transactions'][0]['wallet_id']=[]
    before=deepcopy(source)
    value=normalize(source)
    assert source==before
    with pytest.raises((ValueError,TypeError)):
        validate_archive_records(value,('wallets','categories','transactions','planned_transactions','budgets'))


@pytest.mark.parametrize('source',[None,[],{'wallets':'bad'},{'wallets':[None]},
                                 {'categories':[{'id':True}]}])
def test_malformed_collections_are_left_for_strict_validation(source):
    assert normalize(source) is source
