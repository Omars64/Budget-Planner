"""Private, bounded raster receipts. Never included in ledger list responses."""
import base64
import binascii
import io
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from PIL import Image, UnidentifiedImageError
from .database import get_db
from .index import current_user
from .models import Transaction, TransactionReceipt, utc_now
from .account_security import limit

router=APIRouter()

class ReceiptIn(BaseModel):
    name: str = Field(min_length=1,max_length=180)
    image: str = Field(max_length=2_000_000)

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

def owned(db,user,transaction_id):
    row=db.query(Transaction).filter_by(id=transaction_id,user_id=user.id).with_for_update().first()
    if not row:raise HTTPException(404,'Transaction not found')
    return row

@router.get('/api/transactions/{transaction_id}/receipt')
def receipt(transaction_id:int,user=Depends(current_user),db=Depends(get_db)):
    owned(db,user,transaction_id)
    row=db.get(TransactionReceipt,transaction_id)
    return {'name':row.name,'image':row.image,'saved_at':row.saved_at.isoformat()} if row else None

@router.put('/api/transactions/{transaction_id}/receipt')
def save_receipt(transaction_id:int,payload:ReceiptIn,user=Depends(current_user),db=Depends(get_db)):
    owned(db,user,transaction_id)
    limit(db,f'receipt:{user.id}',30,3600)
    validate_image(payload.image)
    row=db.get(TransactionReceipt,transaction_id)
    if not row:row=TransactionReceipt(transaction_id=transaction_id);db.add(row)
    row.name=payload.name;row.image=payload.image;row.saved_at=utc_now()
    db.commit()
    return {'name':row.name,'image':row.image,'saved_at':row.saved_at.isoformat()}

@router.delete('/api/transactions/{transaction_id}/receipt',status_code=204)
def remove_receipt(transaction_id:int,user=Depends(current_user),db=Depends(get_db)):
    owned(db,user,transaction_id)
    db.query(TransactionReceipt).filter_by(transaction_id=transaction_id).delete()
    db.commit()
