"""Private, bounded raster receipts. Never included in ledger list responses."""
import base64
import binascii
import io
from fastapi import APIRouter, Depends, HTTPException, Request
from .schemas import ReceiptIn
from PIL import Image, UnidentifiedImageError
from .database import get_db
from .index import current_user
from .models import Transaction, TransactionReceipt, utc_now
from .account_security import limit

router=APIRouter()

def validate_image(value):
    try:
        prefix,encoded=value.split(',',1)
        if prefix not in {'data:image/jpeg;base64','data:image/png;base64','data:image/webp;base64'}:
            raise ValueError()
        raw=base64.b64decode(encoded,validate=True)
        if len(raw)>1_500_000:raise ValueError()
        with Image.open(io.BytesIO(raw)) as image:
            if image.format not in {'JPEG','PNG','WEBP'} or image.width*image.height>8_000_000:
                raise ValueError()
            expected={'JPEG':'image/jpeg','PNG':'image/png','WEBP':'image/webp'}[image.format]
            if prefix!=f'data:{expected};base64':raise ValueError()
            image.verify()
        return value
    except (ValueError,binascii.Error,OSError,UnidentifiedImageError,Image.DecompressionBombError):
        raise HTTPException(422,'Choose a valid JPEG, PNG or WebP receipt under 1.5 MB.')

def owned(db,user,transaction_id,shared=False,write=False):
    row=db.query(Transaction).filter_by(id=transaction_id).with_for_update().first()
    if not row:raise HTTPException(404,'Transaction not found')
    if shared:
        from .extensions import shared_wallet_ids, can_edit_wallet
        visible=shared_wallet_ids(db,user)
        if row.wallet_id not in visible and row.transfer_wallet_id not in visible:
            raise HTTPException(404,'Transaction not found')
        if write and (not can_edit_wallet(db,user,row.wallet_id) or (row.type=='transfer' and not can_edit_wallet(db,user,row.transfer_wallet_id))):
            raise HTTPException(403,'You do not have edit access to this transaction')
    elif row.user_id!=user.id:
        raise HTTPException(404,'Transaction not found')
    return row

def store_receipt(db,transaction_id,payload):
    validate_image(payload.image)
    row=db.get(TransactionReceipt,transaction_id)
    if not row:row=TransactionReceipt(transaction_id=transaction_id);db.add(row)
    row.name=payload.name;row.image=payload.image;row.saved_at=utc_now()
    return row

@router.get('/api/transactions/{transaction_id}/receipt')
@router.get('/api/shared/transactions/{transaction_id}/receipt')
def receipt(transaction_id:int,request:Request,user=Depends(current_user),db=Depends(get_db)):
    owned(db,user,transaction_id,shared=request.url.path.startswith('/api/shared/'))
    row=db.get(TransactionReceipt,transaction_id)
    return {'name':row.name,'image':row.image,'saved_at':row.saved_at.isoformat()} if row else None

@router.put('/api/transactions/{transaction_id}/receipt')
@router.put('/api/shared/transactions/{transaction_id}/receipt')
def save_receipt(transaction_id:int,payload:ReceiptIn,request:Request,user=Depends(current_user),db=Depends(get_db)):
    owned(db,user,transaction_id,shared=request.url.path.startswith('/api/shared/'),write=True)
    limit(db,f'receipt:{user.id}',30,3600)
    row=store_receipt(db,transaction_id,payload)
    db.commit()
    return {'name':row.name,'image':row.image,'saved_at':row.saved_at.isoformat()}

@router.delete('/api/transactions/{transaction_id}/receipt',status_code=204)
@router.delete('/api/shared/transactions/{transaction_id}/receipt',status_code=204)
def remove_receipt(transaction_id:int,request:Request,user=Depends(current_user),db=Depends(get_db)):
    owned(db,user,transaction_id,shared=request.url.path.startswith('/api/shared/'),write=True)
    db.query(TransactionReceipt).filter_by(transaction_id=transaction_id).delete()
    db.commit()
