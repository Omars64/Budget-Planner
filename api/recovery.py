"""Recover individual deletions without replacing the current workspace."""
import json
from datetime import datetime, date, timedelta
from fastapi import APIRouter, Depends, HTTPException
from fastapi.encoders import jsonable_encoder
from sqlalchemy import or_
from .database import get_db
from .models import Wallet, Category, Transaction, Budget, Goal, Debt, Note, NoteFolder, utc_now
from .reliability_models import TrashItem
from .index import current_user
from .account_security import audit

router = APIRouter()
MODELS = {'wallet':Wallet, 'category':Category, 'transaction':Transaction, 'note':Note, 'budget':Budget, 'goal':Goal, 'debt':Debt}


def snapshot(row):
    return jsonable_encoder({c.name:getattr(row,c.name) for c in row.__table__.columns if c.name not in {'created_at','updated_at','user_id'}})


def trash(db, row, actor, kind):
    payload = {'item':snapshot(row)}
    if kind == 'wallet':
        payload['transactions'] = [snapshot(t) for t in db.query(Transaction).filter(Transaction.user_id==row.user_id, or_(Transaction.wallet_id==row.id,Transaction.transfer_wallet_id==row.id)).all()]
    if kind == 'transaction':
        payload['transactions'] = [snapshot(t) for t in db.query(Transaction).filter_by(user_id=row.user_id,recurring_parent_id=row.id).all()]
    if kind == 'category':
        payload['transaction_ids'] = [r[0] for r in db.query(Transaction.id).filter_by(user_id=row.user_id,category_id=row.id)]
        payload['budget_ids'] = [r[0] for r in db.query(Budget.id).filter_by(user_id=row.user_id,category_id=row.id)]
    item = TrashItem(user_id=row.user_id, kind=kind, label=getattr(row,'name',None) or getattr(row,'description',None) or getattr(row,'title','Item'), payload=json.dumps(payload))
    db.add(item)
    audit(db,row.user_id,actor.id,'Moved to Trash',f'{kind}:{row.id}')


@router.get('/api/trash')
def list_trash(user=Depends(current_user), db=Depends(get_db)):
    rows=db.query(TrashItem).filter_by(user_id=user.id,restored_at=None).filter(TrashItem.created_at>=utc_now()-timedelta(days=30)).order_by(TrashItem.id.desc()).limit(200).all()
    return [{'id':r.id,'kind':r.kind,'label':r.label,'created_at':r.created_at.isoformat()+'Z','recover_until':(r.created_at+timedelta(days=30)).isoformat()+'Z'} for r in rows]


@router.delete('/api/trash/{item_id}', status_code=204)
def delete_trash(item_id: int, user=Depends(current_user), db=Depends(get_db)):
    item = db.query(TrashItem).filter_by(id=item_id, user_id=user.id).with_for_update().first()
    if not item:
        raise HTTPException(404, 'Deleted item not found')
    audit(db, user.id, user.id, 'Permanently deleted Trash item', f'trash:{item.id}')
    db.delete(item)
    db.commit()


def owned(db, model, ident, user_id):
    return db.query(model).filter_by(id=ident,user_id=user_id).first() if ident else None


def restore_row(db, model, values, user_id, wallet_map=None):
    data={k:v for k,v in values.items() if k not in {'id','user_id','recurring_parent_id'}}
    for name in ('date','updated_at'):
        if data.get(name): data[name]=datetime.fromisoformat(data[name])
    for name in ('recurring_until','start_date','deadline','due_date'):
        if data.get(name): data[name]=date.fromisoformat(data[name])
    if model is Transaction:
        for name in ('wallet_id','transfer_wallet_id'):
            if wallet_map: data[name]=wallet_map.get(data.get(name),data.get(name))
            if data.get(name) and not owned(db,Wallet,data[name],user_id):
                raise HTTPException(409,'Restore the linked wallet first, then try again.')
        if data.get('category_id') and not owned(db,Category,data['category_id'],user_id): data['category_id']=None
    if model is Note:
        if not owned(db,NoteFolder,data.get('folder_id'),user_id): data['folder_id']=None
        data['version']=data.get('version',1)+1
    if model is Budget and not owned(db,Category,data.get('category_id'),user_id): data['category_id']=None
    row=model(user_id=user_id,**data); db.add(row); db.flush()
    return row


@router.post('/api/trash/{item_id}/restore')
def restore(item_id:int,user=Depends(current_user),db=Depends(get_db)):
    item=db.query(TrashItem).filter_by(id=item_id,user_id=user.id).with_for_update().first()
    if not item: raise HTTPException(404,'Deleted item not found')
    if item.restored_at: return {'ok':True,'already_restored':True}
    if item.created_at<utc_now()-timedelta(days=30): raise HTTPException(410,'The 30-day recovery period has ended')
    claimed=db.query(TrashItem).filter_by(id=item.id,restored_at=None).update({'restored_at':utc_now()})
    if not claimed: return {'ok':True,'already_restored':True}
    data=json.loads(item.payload)
    row=restore_row(db,MODELS[item.kind],data['item'],user.id)
    wallet_map={data['item']['id']:row.id} if item.kind=='wallet' else {}
    tx_map={data['item']['id']:row.id} if item.kind=='transaction' else {}
    restored=[]
    for tx in data.get('transactions',[]):
        new=restore_row(db,Transaction,tx,user.id,wallet_map)
        tx_map[tx['id']]=new.id; restored.append((new,tx.get('recurring_parent_id')))
    for new,parent in restored:
        new.recurring_parent_id=tx_map.get(parent)
    if item.kind=='category':
        for model,key in [(Transaction,'transaction_ids'),(Budget,'budget_ids')]:
            db.query(model).filter(model.user_id==user.id,model.id.in_(data.get(key,[])),model.category_id.is_(None)).update({'category_id':row.id},synchronize_session=False)
    audit(db,user.id,user.id,'Restored from Trash',f'{item.kind}:{row.id}'); db.commit()
    return {'ok':True,'id':row.id}


@router.get('/api/workspace/clear-preview')
def clear_preview(user=Depends(current_user),db=Depends(get_db)):
    return {name:db.query(model).filter_by(user_id=user.id).count() for name,model in [('transactions',Transaction),('wallets',Wallet),('budgets',Budget),('goals',Goal),('debts',Debt),('notes',Note),('categories_preserved',Category)]}
