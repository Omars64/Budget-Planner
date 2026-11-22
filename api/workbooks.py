"""Account-owned workbooks. Content is an XLSX package with optimistic revision checks."""
import base64
import binascii
import hashlib
import io
import json
import secrets
import zipfile
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .database import get_db
from .index import current_user
from .models import User, Workbook, utc_now
from . import google_drive as drive

router = APIRouter(prefix='/api/workbooks', tags=['Workbooks'])
MAX_BYTES = 2 * 1024 * 1024
MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'


class BookIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    revision: int = Field(ge=0)
    data: str = Field(max_length=4 * ((MAX_BYTES + 2) // 3))


def package(data):
    try:
        raw = base64.b64decode(data, validate=True)
        if len(raw) > MAX_BYTES:
            raise ValueError
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            files = archive.infolist()
            if (len(files) > 800 or sum(f.file_size for f in files) > 16 * 1024 * 1024
                    or 'xl/workbook.xml' not in archive.namelist()):
                raise ValueError
        return raw
    except (ValueError, binascii.Error, zipfile.BadZipFile):
        raise HTTPException(422, 'Choose a supported XLSX workbook up to 2 MB.') from None


@router.get('')
def list_books(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.query(Workbook.id, Workbook.name, Workbook.revision).filter_by(user_id=user.id).order_by(Workbook.updated.desc())
    return drive.private([dict(row._mapping) for row in rows])


@router.get('/{book_id:uuid}')
def get_book(book_id: UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = db.query(Workbook).filter_by(id=str(book_id), user_id=user.id).first()
    if not row:
        raise HTTPException(404, 'Workbook unavailable.')
    return drive.private({'id': row.id, 'name': row.name, 'revision': row.revision, 'data': base64.b64encode(row.content).decode()})


@router.put('/{book_id:uuid}')
def put_book(book_id: UUID, payload: BookIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    raw = package(payload.data)
    books = db.query(Workbook).filter_by(user_id=user.id)
    revision = payload.revision + 1
    if payload.revision:
        if not books.filter_by(id=str(book_id), revision=payload.revision).update(
            {'content': raw, 'name': payload.name, 'revision': revision, 'updated': utc_now()}):
            raise HTTPException(409, 'This workbook changed. Reopen it before saving your edit.')
    else:
        if books.count() >= 50:
            raise HTTPException(409, 'Your library holds up to 50 workbooks.')
        db.add(Workbook(id=str(book_id), user_id=user.id, name=payload.name, revision=1, content=raw))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, 'This workbook already exists. Reopen your library.') from None
    return {'id': str(book_id), 'name': payload.name, 'revision': revision}


@router.delete('/{book_id:uuid}')
def delete_book(book_id: UUID, revision: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if not db.query(Workbook).filter_by(id=str(book_id), user_id=user.id, revision=revision).delete():
        raise HTTPException(409, 'Reopen the library to see the latest workbook.')
    db.commit()
    return {'deleted': True}


class GoogleImportIn(BaseModel):
    android: bool = False


@router.post('/google/start')
def google_start(payload: GoogleImportIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return drive.start_authorization(request, user, db, workbook=True, android=payload.android)


@router.post('/google/poll')
async def google_poll(payload: drive.PollIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = db.query(drive.GoogleDriveOAuthAttempt).filter_by(id=payload.flow_id, user_id=user.id).first()
    if (not row or row.session_id != getattr(request.state, 'session_id', None)
            or not secrets.compare_digest(row.poll_hash, hashlib.sha256(payload.poll_secret.encode()).hexdigest())):
        raise HTTPException(404, 'Import request unavailable.')
    if row.expires_at <= utc_now():
        return {'status': 'expired'}
    if row.status in ('sheet_pending', 'sheet_exchange'):
        return {'status': 'pending'}
    if row.status != 'sheet_ready':
        return {'status': 'cancelled'}
    _, cipher = drive.configuration()
    token, file_id = json.loads(drive.decrypt(cipher, row.verifier))
    headers = {'Authorization': 'Bearer ' + token}
    metadata = drive.object_json(await drive.google_request('GET', drive.FILES_URL + '/' + file_id,
                                    headers=headers, params={'fields': 'name,mimeType'}))
    if metadata.get('mimeType') != 'application/vnd.google-apps.spreadsheet':
        raise HTTPException(422, 'Choose a Google Sheets workbook.')
    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=False, trust_env=False) as client:
            async with client.stream('GET', drive.FILES_URL + '/' + file_id + '/export', headers=headers,
                                     params={'mimeType': MIME}) as response:
                if response.status_code != 200:
                    raise HTTPException(422, 'Google could not export this sheet. Check its permissions.')
                data = bytearray()
                async for chunk in response.aiter_bytes(65536):
                    data.extend(chunk)
                    if len(data) > MAX_BYTES:
                        raise HTTPException(413, 'Choose a workbook up to 2 MB.')
    except httpx.HTTPError:
        raise HTTPException(502, 'Google Drive is unavailable.') from None
    encoded = base64.b64encode(data).decode()
    package(encoded)
    row.verifier = None
    row.status = 'imported'
    db.commit()
    return drive.private({'status': 'ready', 'name': metadata['name'], 'data': encoded})
