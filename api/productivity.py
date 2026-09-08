import csv
import io
import json
import hashlib
from datetime import datetime
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


class ImportIn(BaseModel):
    transactions:list[TransactionIn]=Field(min_length=1,max_length=500)


def duplicate(db,user_id,tx):
    return db.query(Transaction).filter_by(user_id=user_id,wallet_id=tx.wallet_id,date=tx.date,amount=tx.amount,description=tx.description,type=tx.type).first() is not None


@router.post('/api/statements/preview')
def preview(payload:CsvIn,user=Depends(current_user),db=Depends(get_db)):
    if not db.query(Wallet).filter_by(id=payload.wallet_id,user_id=user.id,archived=False).first():raise HTTPException(404,'Choose an active wallet')
    rows=[]
    reader=csv.DictReader(io.StringIO(payload.text.lstrip('\ufeff')))
    if not reader.fieldnames:raise HTTPException(422,'The CSV file is empty')
    names=[name.strip().lower() for name in reader.fieldnames]
    if not {'date','description'}.issubset(names) or not any(x in names for x in ['amount','debit','credit']):
        raise HTTPException(422,'Use columns date, description, amount, type; or date, description, debit, credit. Dates must be YYYY-MM-DD with an optional time.')
    for number,original in enumerate(reader,2):
        if len(rows)>=500:raise HTTPException(422,'Import at most 500 rows at a time')
        row={str(k).strip().lower():v for k,v in original.items() if k is not None}
        try:
            amount=Decimal((row.get('amount') or row.get('debit') or row.get('credit') or '').replace(',',''))
            kind=(row.get('type') or ('income' if row.get('credit') and not row.get('debit') else 'expense')).strip().lower()
            tx=TransactionIn(type=kind,amount=abs(amount),description=row.get('description','').strip(),date=datetime.fromisoformat(row.get('date','').strip()),wallet_id=payload.wallet_id)
            if tx.type=='transfer':raise ValueError('Transfers must be entered separately')
            rows.append({'line':number,'transaction':jsonable_encoder(tx),'duplicate':duplicate(db,user.id,tx),'error':None})
        except (ValueError,InvalidOperation,ValidationError):
            rows.append({'line':number,'transaction':None,'duplicate':False,'error':'Check the date, amount, description and type (income or expense).'})
    return rows


@router.post('/api/statements/import')
def import_statement(payload:ImportIn,request:Request,user=Depends(current_user),db=Depends(get_db)):
    receipt,previous=reserve(db,user.id,'statement',request.headers.get('Idempotency-Key'),payload)
    if previous is not None:return previous
    count=0;skipped=0
    for tx in payload.transactions:
        validate_transaction_references(db,user.id,tx)
        if tx.type=='transfer' or tx.recurring_frequency!='none':raise HTTPException(422,'Statements support one-time income and expenses only')
        # The account lock serializes overlapping imports from different devices.
        from .models import User
        db.query(User).filter_by(id=user.id).with_for_update().first()
        if duplicate(db,user.id,tx):skipped+=1;continue
        row=Transaction(user_id=user.id,**tx.model_dump());db.add(row);db.flush();count+=1
    result={'imported':count,'skipped':skipped}
    if receipt:receipt.response=json.dumps(result)
    audit(db,user.id,user.id,f'Imported {count} statement transactions');db.commit();return result
