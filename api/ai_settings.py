"""Server-owned, installation-wide assistant policy. Never expose credentials."""
import os
from contextlib import contextmanager
from contextvars import ContextVar
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


_request_policy = ContextVar('ai_request_policy', default=None)


@contextmanager
def policy_snapshot(policy):
    token = _request_policy.set(policy)
    try:
        yield
    finally:
        _request_policy.reset(token)


# Shared policy is optional during rolling deployments; validate local defaults too.
def operational_policy():
    from . import resource_control as control
    snapshot = _request_policy.get()
    if snapshot is not None:
        return snapshot
    state = control.read_state()
    policy = state.get('policy', {})
    coordination = state.get('coordination', {})
    unavailable = coordination.get('configured', False) and not coordination.get('healthy', False)
    defaults = {
        'ai_global_daily_requests': (50, 0, 1000),
        'ai_user_daily_requests': (50, 0, 500),
        'ai_global_minute_requests': (15, 1, 60),
        'ai_max_output_tokens': (1800, 128, 1800),
        'notification_batch_size': (5, 1, 20),
    }
    result = {}
    for key, (default, low, high) in defaults.items():
        value = policy.get(key, default)
        result[key] = max(low, min(high, value)) if type(value) is int else default
    for key in ('release_notifications_enabled', 'scheduled_notifications_enabled', 'upcoming_notifications_enabled'):
        value = policy.get(key, True)
        result[key] = value if type(value) is bool else True
    if unavailable:
        result['ai_global_daily_requests'] = 0
        for key in ('release_notifications_enabled', 'scheduled_notifications_enabled', 'upcoming_notifications_enabled'):
            result[key] = False
    return result


def record_ai_metric(name, value=1):
    # Operational aggregates only: never attach user IDs, prompts or credentials.
    try:
        from . import resource_control as control
        recorder = getattr(control, 'record_metric', None)
        if recorder and value:
            recorder(name, value)
    except Exception:
        pass


def reserve_ai(db, user_id):
    policy = operational_policy()
    if not policy['ai_global_daily_requests'] or not policy['ai_user_daily_requests']:
        raise HTTPException(429, 'AI request limit reached. Using built-in guidance.')
    # limit() uses an atomic UPDATE RETURNING, handles first-insert conflicts,
    # and commits each bucket before returning. No process-local counters or
    # read/modify/write counts: concurrent workers cannot bypass the ceiling.
    # Partial reservations are conservative and are never refunded on failure.
    limit(db, 'openai-day', policy['ai_global_daily_requests'], 86400)
    limit(db, 'openai-minute', policy['ai_global_minute_requests'], 60)
    limit(db, f'openai-user-day:{user_id}', policy['ai_user_daily_requests'], 86400)
    return policy


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
    try:
        policy = reserve_ai(db, user.id)
    except HTTPException:
        record_ai_metric('ai_fallbacks')
        return {'ok': False, 'reason': 'rate_limit', 'message': 'AI request limit reached. Using built-in guidance.'}
    try:
        with policy_snapshot(policy):
            return check_connection()
    except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError) as error:
        record_ai_metric('ai_fallbacks')
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
