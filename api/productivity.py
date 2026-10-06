import csv
import io
import json
import hashlib
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, Field, ValidationError
from .database import get_db
from .index import current_user, validate_transaction_references, tx_payload
from .models import Transaction, Wallet
from .reliability_models import TransactionTemplate
from .schemas import TransactionIn
from .idempotency import reserve
from .account_security import audit

router=APIRouter()


class TemplateIn(BaseModel):
    name: str = Field(min_length=1,max_length=100)
    transaction: TransactionIn


@router.get('/api/transaction-templates')
def templates(user=Depends(current_user),db=Depends(get_db)):
    return [{'id':r.id,'name':r.name,'transaction':json.loads(r.payload)} for r in db.query(TransactionTemplate).filter_by(user_id=user.id).order_by(TransactionTemplate.name).all()]


@router.post('/api/transaction-templates',status_code=201)
def template(payload:TemplateIn,request:Request,user=Depends(current_user),db=Depends(get_db)):
    receipt,previous=reserve(db,user.id,'template',request.headers.get('Idempotency-Key'),payload)
    if previous is not None:return previous
    validate_transaction_references(db,user.id,payload.transaction)
    if not payload.name.strip():raise HTTPException(422,'Enter a template name')
    row=TransactionTemplate(user_id=user.id,name=payload.name.strip(),payload=payload.transaction.model_dump_json())
    db.add(row);db.flush();result={'id':row.id}
    if receipt:receipt.response=json.dumps(result)
    db.commit();return result


@router.delete('/api/transaction-templates/{template_id}',status_code=204)
def remove_template(template_id:int,user=Depends(current_user),db=Depends(get_db)):
    db.query(TransactionTemplate).filter_by(id=template_id,user_id=user.id).delete();db.commit()


class CsvIn(BaseModel):
    text:str=Field(max_length=1000000)
    wallet_id:int


class ImportTransaction(TransactionIn):
    matched_transaction_id: int | None = Field(default=None, ge=1)


class ImportIn(BaseModel):
    transactions:list[ImportTransaction]=Field(min_length=1,max_length=500)


def duplicate(db,user_id,tx):
    return db.query(Transaction).filter_by(user_id=user_id,wallet_id=tx.wallet_id,date=tx.date,amount=tx.amount,description=tx.description,type=tx.type).first() is not None


@router.post('/api/statements/preview')
def preview(payload:CsvIn,user=Depends(current_user),db=Depends(get_db)):
    if not db.query(Wallet).filter_by(id=payload.wallet_id,user_id=user.id,archived=False).first():raise HTTPException(404,'Choose an active wallet')
    rows=[]
    seen=set()
    reader=csv.DictReader(io.StringIO(payload.text.lstrip('\ufeff')))
    if not reader.fieldnames:raise HTTPException(422,'The CSV file is empty')
    names=[name.strip().lower() for name in reader.fieldnames]
    if not {'date','description'}.issubset(names) or not any(x in names for x in ['amount','debit','credit']):
        raise HTTPException(422,'Use columns date, description, amount, type; or date, description, debit, credit. Dates must be YYYY-MM-DD with an optional time.')
    originals=[]
    dates=[]
    from .timekeeping import ledger_time
    for original in reader:
        if len(originals)>=500:raise HTTPException(422,'Import at most 500 rows at a time')
        originals.append(original)
        normalized={str(k).strip().lower():v for k,v in original.items() if k is not None}
        try:dates.append(ledger_time(datetime.fromisoformat(normalized.get('date','').strip())))
        except (ValueError,AttributeError):pass
    existing=[]
    if dates:
        existing=db.query(Transaction).filter(Transaction.user_id==user.id,Transaction.wallet_id==payload.wallet_id,Transaction.date>=min(dates)-timedelta(days=3),Transaction.date<=max(dates)+timedelta(days=3)).order_by(Transaction.date.desc()).limit(20001).all()
        if len(existing)>20000:raise HTTPException(413,'Choose a statement covering a shorter date range.')
    for number,original in enumerate(originals,2):
        if len(rows)>=500:raise HTTPException(422,'Import at most 500 rows at a time')
        row={str(k).strip().lower():v for k,v in original.items() if k is not None}
        try:
            amount=Decimal((row.get('amount') or row.get('debit') or row.get('credit') or '').replace(',',''))
            kind=(row.get('type') or ('income' if row.get('credit') and not row.get('debit') else 'expense')).strip().lower()
            row_date = datetime.fromisoformat(row.get('date','').strip())
            reporting_month = row.get('reporting_month', '').strip() or row_date.strftime('%Y-%m')
            tx=TransactionIn(type=kind,amount=abs(amount),description=row.get('description','').strip(),date=row_date,wallet_id=payload.wallet_id,reporting_month=reporting_month)
            if tx.type=='transfer':raise ValueError('Transfers must be entered separately')
            signature=(tx.type,tx.date,tx.amount,tx.description.casefold())
            exact=next((item for item in existing if item.type==tx.type and item.date==tx.date and item.amount==tx.amount and item.description==tx.description),None)
            candidates=[{'id':item.id,'description':item.description,'date':item.date.isoformat(),'amount':float(item.amount)} for item in existing if not item.is_opening_balance and item.type==tx.type and item.amount==tx.amount and abs(item.date-tx.date)<=timedelta(days=3)][:3]
            rows.append({'line':number,'transaction':jsonable_encoder(tx),'duplicate':bool(exact) or signature in seen,'candidates':candidates,'error':None})
            seen.add(signature)
        except (ValueError,InvalidOperation,ValidationError):
            rows.append({'line':number,'transaction':None,'duplicate':False,'error':'Check the date, amount, description and type (income or expense).'})
    return rows


@router.post('/api/statements/import')
def import_statement(payload:ImportIn,request:Request,user=Depends(current_user),db=Depends(get_db)):
    receipt,previous=reserve(db,user.id,'statement',request.headers.get('Idempotency-Key'),payload)
    if previous is not None:return previous
    count=0;skipped=0;matched=0;matched_ids=set()
    for tx in payload.transactions:
        validate_transaction_references(db,user.id,tx)
        if tx.type=='transfer' or tx.recurring_frequency!='none':raise HTTPException(422,'Statements support one-time income and expenses only')
        # The account lock serializes overlapping imports from different devices.
        from .models import User
        db.query(User).filter_by(id=user.id).with_for_update().first()
        if tx.matched_transaction_id is not None:
            if tx.matched_transaction_id in matched_ids:
                raise HTTPException(422,'Match each existing transaction only once per statement.')
            match=db.query(Transaction).filter_by(id=tx.matched_transaction_id,user_id=user.id,wallet_id=tx.wallet_id).first()
            if not match or match.is_opening_balance or match.type!=tx.type or match.amount!=tx.amount or abs(match.date-tx.date)>timedelta(days=3):
                raise HTTPException(409,'A selected match changed. Preview the statement again.')
            matched_ids.add(tx.matched_transaction_id);matched+=1;continue
        if duplicate(db,user.id,tx):skipped+=1;continue
        row=Transaction(user_id=user.id,**tx.model_dump(exclude={'matched_transaction_id'}));db.add(row);db.flush();count+=1
    result={'imported':count,'skipped':skipped,'matched':matched}
    if receipt:receipt.response=json.dumps(result)
    audit(db,user.id,user.id,f'Imported {count} statement transactions');db.commit();return result
