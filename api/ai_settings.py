"""Server-owned, installation-wide assistant policy. Never expose credentials."""
import os
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, StrictBool
from .database import get_db
from .index import admin_user
from .ai_models import AssistantConfig
from .account_security import audit, confirmed, limit
from .models import utc_now

MODEL = 'gpt-4o-mini'
router = APIRouter(prefix='/api/admin/assistant', tags=['Admin assistant'])


def assistant_status(db):
    row = db.query(AssistantConfig).populate_existing().filter_by(id=1).first()
    configured = bool(os.getenv('OPENAI_API_KEY', '').strip())
    valid_model = os.getenv('OPENAI_MODEL', MODEL).strip() == MODEL
    enabled = bool(row and row.enabled)
    return {'enabled': enabled, 'configured': configured, 'model_valid': valid_model,
            'available': enabled and configured and valid_model, 'model': MODEL}


class AssistantSettingsIn(BaseModel):
    model_config = ConfigDict(extra='forbid')
    enabled: StrictBool


@router.get('')
def get_settings(user=Depends(admin_user), db=Depends(get_db)):
    return assistant_status(db)


@router.post('/check')
def check_provider(user=Depends(admin_user), db=Depends(get_db)):
    from .ai_provider import check_connection
    from .ai_diagnostics import provider_failure
    status = assistant_status(db)
    if not status['available']:
        return {'ok': False, 'reason': 'configuration', 'message': 'Enable AI with a Production API key and the supported model before testing.'}
    limit(db, 'openai-health-minute', 2, 60)
    limit(db, 'openai-minute', 15, 60)
    limit(db, 'openai-day', 50, 86400)
    try:
        return check_connection()
    except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError) as error:
        return provider_failure(error)


@router.put('')
def update_settings(payload: AssistantSettingsIn, request: Request, user=Depends(admin_user), db=Depends(get_db)):
    confirmed(request, db, user)
    status = assistant_status(db)
    if payload.enabled and not (status['configured'] and status['model_valid']):
        raise HTTPException(422, 'Configure OPENAI_API_KEY and set OPENAI_MODEL to gpt-4o-mini in Vercel, then redeploy.')
    from sqlalchemy.dialects.postgresql import insert as pg_insert
    from sqlalchemy.dialects.sqlite import insert as sqlite_insert
    insert = sqlite_insert if db.bind.dialect.name == 'sqlite' else pg_insert
    values = {'enabled': payload.enabled, 'updated_by': user.id, 'updated_at': utc_now()}
    db.execute(insert(AssistantConfig).values(id=1, **values).on_conflict_do_update(index_elements=['id'], set_=values))
    audit(db, user.id, user.id, 'assistant_enabled' if payload.enabled else 'assistant_disabled', 'assistant')
    db.commit()
    return assistant_status(db)
