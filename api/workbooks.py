"""Account-owned workbooks. Content is an XLSX package with optimistic revision checks."""
import base64
import binascii
import hashlib
import io
import json
import re
import secrets
import zipfile
from datetime import timedelta
from pathlib import Path
from urllib.parse import quote
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Path as PathParam, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .database import get_db
from .index import current_user
from .models import User, Workbook, WorkbookTransfer, utc_now
from . import google_drive as drive

router = APIRouter(prefix='/api/workbooks', tags=['Workbooks'])
LIMITS = json.loads((Path(__file__).resolve().parent.parent / 'workbook-limits.json').read_text(encoding='utf-8'))
MAX_BYTES = LIMITS['fileBytes']
PART_BYTES = LIMITS['partBytes']
MAX_PART = (MAX_BYTES - 1) // PART_BYTES
MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
GOOGLE_OPERATIONS = 'https://www.googleapis.com/drive/v3/operations/'
GOOGLE_LARGE_EXPORT = 'Google could not export this sheet directly. Download it as Excel and choose Excel file to import up to 24 MB.'
GOOGLE_RETRY = (429, 500, 502, 503, 504)


class BookIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    revision: int = Field(ge=0)
    data: str = Field(max_length=4 * ((PART_BYTES + 2) // 3))


def decode(data):
    try:
        return base64.b64decode(data, validate=True)
    except (ValueError, binascii.Error):
        raise HTTPException(422, 'The workbook upload is invalid. Choose the file again.') from None


def package(raw):
    if len(raw) > MAX_BYTES:
        raise HTTPException(413, 'Choose an XLSX workbook up to 24 MB.')
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            files = archive.infolist()
            if len(files) > LIMITS['entries'] or sum(f.file_size for f in files) > LIMITS['expandedBytes']:
                raise HTTPException(413, 'This workbook expands to more data than Budgetly can open. Try splitting it into smaller workbooks.')
            if 'xl/workbook.xml' not in archive.namelist():
                raise ValueError
        return raw
    except (ValueError, zipfile.BadZipFile):
        raise HTTPException(422, 'Choose a valid XLSX workbook.') from None


@router.get('')
def list_books(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.query(Workbook.id, Workbook.name, Workbook.revision).filter_by(user_id=user.id).order_by(Workbook.updated.desc())
    return drive.private([dict(row._mapping) for row in rows])


@router.get('/{book_id:uuid}')
def get_book(book_id: UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    query = db.query(Workbook).filter_by(id=str(book_id), user_id=user.id)
    row = query.with_entities(Workbook.id, Workbook.name, Workbook.revision, func.length(Workbook.content).label('size')).first()
    if not row:
        raise HTTPException(404, 'Workbook unavailable.')
    result = {'id': row.id, 'name': row.name, 'revision': row.revision}
    if row.size > PART_BYTES:
        return drive.private({**result, 'size': row.size})
    raw = query.filter_by(revision=row.revision).with_entities(Workbook.content).scalar()
    if raw is None:
        raise HTTPException(409, 'This workbook changed. Reopen it to read the latest version.')
    return drive.private({**result, 'data': base64.b64encode(raw).decode()})


def part_response(query, column, part):
    raw = query.with_entities(func.substr(column, part * PART_BYTES + 1, PART_BYTES)).scalar()
    if not raw:
        raise HTTPException(404, 'Workbook data is unavailable. Reopen the workbook.')
    return drive.private({'data': base64.b64encode(raw).decode()})


@router.get('/{book_id:uuid}/parts/{part}')
def get_book_part(book_id: UUID, part: int = PathParam(ge=0, le=MAX_PART), revision: int = Query(ge=1),
                  user: User = Depends(current_user), db: Session = Depends(get_db)):
    query = db.query(Workbook).filter_by(id=str(book_id), user_id=user.id, revision=revision)
    return part_response(query, Workbook.content, part)


@router.put('/{book_id:uuid}')
def put_book(book_id: UUID, payload: BookIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    raw = decode(payload.data)
    if len(raw) > PART_BYTES:
        raise HTTPException(413, 'Transfer larger workbooks in parts.')
    return save_workbook(db, user, str(book_id), payload.name, payload.revision, raw)


def save_workbook(db, user, book_id, name, expected_revision, raw, *, transfer=None):
    package(raw)
    books = db.query(Workbook).filter_by(user_id=user.id)
    revision = expected_revision + 1
    if expected_revision:
        if not books.filter_by(id=book_id, revision=expected_revision).update(
            {'content': raw, 'name': name, 'revision': revision, 'updated': utc_now()}):
            raise HTTPException(409, 'This workbook changed. Reopen it before saving your edit.')
    else:
        db.query(User.id).filter_by(id=user.id).with_for_update().one()
        if books.count() >= 50:
            raise HTTPException(409, 'Your library holds up to 50 workbooks.')
        db.add(Workbook(id=book_id, user_id=user.id, name=name, revision=1, content=raw))
    result = {'id': book_id, 'name': name, 'revision': revision}
    if transfer is not None:
        transfer.info = {**transfer.info, 'saved': result}
        transfer.content = b''
        transfer.kind = 'saved'
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, 'This workbook already exists. Reopen your library.') from None
    return result


class UploadIn(BaseModel):
    book_id: UUID
    name: str = Field(min_length=1, max_length=120)
    revision: int = Field(ge=0)
    size: int = Field(gt=PART_BYTES, le=MAX_BYTES)


class PartIn(BaseModel):
    data: str = Field(max_length=4 * ((PART_BYTES + 2) // 3))


def uploads(db, user, transfer_id):
    return db.query(WorkbookTransfer).filter_by(id=str(transfer_id), user_id=user.id).filter(
        WorkbookTransfer.kind.in_(('upload', 'saved')), WorkbookTransfer.expires_at > utc_now(),
    )


@router.put('/uploads/{transfer_id}')
def begin_upload(transfer_id: UUID, payload: UploadIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.query(User.id).filter_by(id=user.id).with_for_update().one()
    db.query(WorkbookTransfer).filter(WorkbookTransfer.user_id == user.id, WorkbookTransfer.expires_at <= utc_now()).delete(synchronize_session=False)
    info = payload.model_dump(mode='json')
    existing = uploads(db, user, transfer_id).first()
    if existing:
        if any(existing.info.get(key) != value for key, value in info.items()):
            raise HTTPException(409, 'This transfer is already in use.')
        return {'received': existing.received}
    if db.query(WorkbookTransfer).filter_by(user_id=user.id, kind='upload').count() >= 8:
        raise HTTPException(429, 'Finish your pending workbook transfers, then try again.')
    db.add(WorkbookTransfer(id=str(transfer_id), user_id=user.id, kind='upload', info=info,
                            content=b'', received=0, expires_at=utc_now()+timedelta(minutes=30)))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, 'This transfer is already in use.') from None
    return {'received': 0}


def upload_locked(db, user, transfer_id):
    query = uploads(db, user, transfer_id)
    # The write also serializes competing requests on SQLite.
    if not query.update({'received': WorkbookTransfer.received}, synchronize_session=False):
        raise HTTPException(404, 'This transfer expired. Save the workbook again.')
    return query.populate_existing().one()


@router.put('/uploads/{transfer_id}/parts/{part}')
def put_part(transfer_id: UUID, payload: PartIn, part: int = PathParam(ge=0, le=MAX_PART),
             user: User = Depends(current_user), db: Session = Depends(get_db)):
    transfer = upload_locked(db, user, transfer_id)
    size = transfer.info['size']
    offset = part * PART_BYTES
    chunk = decode(payload.data)
    if offset >= size or len(chunk) != min(PART_BYTES, size-offset):
        raise HTTPException(422, 'This workbook part is incomplete or invalid.')
    if offset < transfer.received:
        if not transfer.info.get('saved') and transfer.content[offset:offset+len(chunk)] != chunk:
            raise HTTPException(409, 'This workbook part differs from the one already received.')
        return {'received': transfer.received}
    if offset != transfer.received:
        raise HTTPException(409, 'Some workbook parts are missing. Save the workbook again.')
    transfer.content += chunk
    transfer.received += len(chunk)
    received = transfer.received
    db.commit()
    return {'received': received}


@router.post('/uploads/{transfer_id}/finish')
def finish_upload(transfer_id: UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    # Acquire the account lock before the transfer to match begin_upload.
    db.query(User.id).filter_by(id=user.id).with_for_update().one()
    transfer = upload_locked(db, user, transfer_id)
    info = transfer.info
    if info.get('saved'):
        return info['saved']
    if transfer.received != info['size']:
        raise HTTPException(409, 'The workbook transfer is incomplete.')
    return save_workbook(db, user, info['book_id'], info['name'], info['revision'], transfer.content, transfer=transfer)


@router.delete('/uploads/{transfer_id}', status_code=204)
def delete_upload(transfer_id: UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    uploads(db, user, transfer_id).delete(synchronize_session=False)
    db.commit()


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


def google_transfer(db, user_id, flow_id):
    return db.query(WorkbookTransfer).filter_by(id=flow_id, kind='google', user_id=user_id).filter(
        WorkbookTransfer.expires_at > utc_now(),
    )


def google_result(db, user_id, flow_id):
    query = google_transfer(db, user_id, flow_id)
    result = query.with_entities(WorkbookTransfer.info, WorkbookTransfer.received).first()
    if not result:
        return {'status': 'expired'}
    if result.received > PART_BYTES:
        return drive.private({'status': 'ready', **result.info, 'size': result.received, 'transfer_id': flow_id})
    content = query.with_entities(WorkbookTransfer.content).scalar()
    if content is None:
        return {'status': 'expired'}
    return drive.private({'status': 'ready', **result.info, 'data': base64.b64encode(content).decode()})


@router.get('/google/{flow_id}/parts/{part}')
def google_part(flow_id: str, request: Request, part: int = PathParam(ge=0, le=MAX_PART),
                user: User = Depends(current_user), db: Session = Depends(get_db)):
    authorized = db.query(drive.GoogleDriveOAuthAttempt.id).filter_by(
        id=flow_id, user_id=user.id, status='imported', session_id=getattr(request.state, 'session_id', None),
    ).filter(drive.GoogleDriveOAuthAttempt.expires_at > utc_now()).first()
    if not authorized:
        raise HTTPException(404, 'Import request unavailable.')
    return part_response(google_transfer(db, user.id, flow_id), WorkbookTransfer.content, part)


async def stream_xlsx(response, limit):
    raw = bytearray()
    async for chunk in response.aiter_bytes(65536):
        raw.extend(chunk)
        if len(raw) > limit:
            return None
    return bytes(raw)


async def standard_google_export(client, url, headers):
    async with client.stream('GET', url + '/export', headers=headers, params={'mimeType': MIME}) as response:
        if response.status_code == 200:
            return await stream_xlsx(response, LIMITS['googleBytes'])
        if response.status_code == 413:
            return None
        if response.status_code == 403 and b'exportSizeLimitExceeded' in await anext(response.aiter_bytes(8192), b''):
            return None
        if response.status_code in GOOGLE_RETRY:
            raise HTTPException(502, 'Google Drive is temporarily unavailable.')
        raise HTTPException(422, 'Google could not export this sheet. Check its permissions.')


def operation_details(result):
    if result.get('done') is True:
        value = result.get('response')
        uri = value.get('downloadUri') if isinstance(value, dict) else None
        if isinstance(uri, str) and uri:
            return None, uri
    else:
        name = result.get('name')
        match = isinstance(name, str) and re.fullmatch(r'(?:operations/)?([A-Za-z0-9_.~=-]{1,500})', name)
        if match and match[1] not in ('.', '..'):
            return match[1], None
    raise HTTPException(422, GOOGLE_LARGE_EXPORT)


async def google_operation(client, method, url, headers, **kwargs):
    async with client.stream(method, url, headers=headers, **kwargs) as response:
        if response.status_code in GOOGLE_RETRY:
            raise HTTPException(502, 'Google Drive is temporarily unavailable.')
        if response.status_code != 200:
            raise HTTPException(422, GOOGLE_LARGE_EXPORT)
        data = await stream_xlsx(response, 1024 * 1024)
        if data is None:
            raise HTTPException(422, GOOGLE_LARGE_EXPORT)
        return operation_details(drive.object_json(httpx.Response(200, content=data)))


async def download_google_export(client, uri, headers):
    url = httpx.URL(uri)
    authorized_hosts = {'www.googleapis.com', 'drive.google.com', 'docs.google.com', 'drive.usercontent.google.com'}
    for _ in range(5):
        if (url.scheme != 'https' or url.port not in (None, 443) or url.userinfo
                or url.host not in authorized_hosts and not url.host.endswith('.googleusercontent.com')):
            break
        # Signed content hosts need no OAuth token.
        async with client.stream('GET', url, headers=headers if url.host in authorized_hosts else {}) as response:
            if response.status_code == 200:
                raw = await stream_xlsx(response, MAX_BYTES)
                if raw is None:
                    raise HTTPException(413, 'This sheet exceeds the 24 MB workbook import limit.')
                return raw
            if response.status_code in GOOGLE_RETRY:
                raise HTTPException(502, 'Google Drive is temporarily unavailable.')
            location = response.headers.get('location')
            if not response.is_redirect or not location:
                break
            url = url.join(location)
    raise HTTPException(422, GOOGLE_LARGE_EXPORT)


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
    if row.status == 'imported':
        return google_result(db, user.id, row.id)
    if row.status not in ('sheet_ready', 'sheet_export'):
        return {'status': 'cancelled'}
    _, cipher = drive.configuration()
    state = json.loads(drive.decrypt(cipher, row.verifier))
    token = state[0]
    user_id, flow_id, status = user.id, row.id, row.status
    db.rollback()
    headers = {'Authorization': 'Bearer ' + token}
    active = db.query(drive.GoogleDriveOAuthAttempt).filter_by(id=flow_id, user_id=user_id, status=status).filter(
        drive.GoogleDriveOAuthAttempt.expires_at > utc_now(),
    )

    def continue_export(sheet_name, operation, uri):
        grant = cipher.encrypt(json.dumps([token, sheet_name, operation, uri]).encode()).decode()
        active.update({'verifier': grant, 'status': 'sheet_export'}, synchronize_session=False)
        db.commit()
        return drive.private({'status': 'processing'})

    try:
        async with httpx.AsyncClient(timeout=45, follow_redirects=False, trust_env=False) as client:
            if status == 'sheet_ready':
                url = drive.FILES_URL + '/' + state[1]
                metadata = drive.object_json(await drive.google_request('GET', url, headers=headers,
                                                params={'fields': 'name,mimeType'}))
                if metadata.get('mimeType') != 'application/vnd.google-apps.spreadsheet':
                    raise HTTPException(422, 'Choose a Google Sheets workbook.')
                name = metadata.get('name') or 'Google Sheet'
                data = await standard_google_export(client, url, headers)
                if data is None:
                    operation, uri = await google_operation(client, 'POST', url + '/download', headers, params={'mimeType': MIME})
                    return continue_export(name, operation, uri)
            else:
                _, name, operation, uri = state
                if uri is None:
                    _, uri = await google_operation(client, 'GET', GOOGLE_OPERATIONS + quote(operation, safe=''), headers)
                    return continue_export(name, None, uri) if uri is not None else drive.private({'status': 'processing'})
                data = await download_google_export(client, uri, headers)
    except httpx.InvalidURL:
        raise HTTPException(422, GOOGLE_LARGE_EXPORT) from None
    except httpx.HTTPError:
        raise HTTPException(502, 'Google Drive is unavailable.') from None
    raw = package(data)
    until = utc_now() + timedelta(minutes=30)
    changed = active.update({'verifier': None, 'status': 'imported', 'expires_at': until}, synchronize_session=False)
    if not changed:
        return google_result(db, user_id, flow_id)
    db.add(WorkbookTransfer(id=flow_id, user_id=user_id, kind='google', info={'name': name},
                            content=raw, received=len(raw), expires_at=until))
    db.commit()
    return google_result(db, user_id, flow_id)
