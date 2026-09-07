"""Reserve a request key in the same transaction as the financial write."""
import hashlib
import json
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from .models import RequestReceipt


def reserve(db, user_id, scope, key, payload):
    if not key:
        return None, None
    if len(key) > 80:
        raise HTTPException(422, 'Invalid request identifier')
    if db.get_bind().dialect.name == 'sqlite':
        connection = db.connection()
        # SQLite otherwise may commit a first SAVEPOINT independently of the ledger write.
        if not connection.connection.driver_connection.in_transaction:
            connection.exec_driver_sql('BEGIN IMMEDIATE')
    digest = hashlib.sha256(payload.model_dump_json().encode()).hexdigest()
    receipt = RequestReceipt(user_id=user_id, scope=scope, key=key, digest=digest)
    try:
        with db.begin_nested():
            db.add(receipt)
            db.flush()
    except IntegrityError:
        receipt = db.query(RequestReceipt).filter_by(user_id=user_id, scope=scope, key=key).one()
        if receipt.digest != digest:
            raise HTTPException(409, 'This request identifier was already used for different data')
        return receipt, json.loads(receipt.response)
    return receipt, None
