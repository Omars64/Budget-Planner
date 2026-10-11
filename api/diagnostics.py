"""Allowlisted client signals and a public, non-identifying readiness probe."""
from typing import Literal
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, ConfigDict
from sqlalchemy import text
from .database import get_db, IS_EPHEMERAL_VERCEL_SQLITE
from .auth_dependency import current_user
from .account_security import limit
from .monitoring import job_status
from .reliability_models import ServiceEvent

router = APIRouter()


class ClientSignal(BaseModel):
    model_config = ConfigDict(extra='forbid')
    code: Literal['render', 'unhandled', 'asset']
    version: str = Field(pattern=r'^\d{1,3}\.\d{1,3}\.\d{1,3}$')
    page: Literal['/', '/transactions', '/wallets', '/settings', '/ask-ai', '/upcoming', '/planner',
                  '/budgets', '/analytics', '/notes', '/attention', '/calendar', '/admin', '/feedback',
                  '/shared-transactions', '/goals', '/bank-messages', 'other'] = 'other'


@router.post('/api/diagnostics/client-error', status_code=204)
def client_error(payload: ClientSignal, user=Depends(current_user), db=Depends(get_db)):
    limit(db, f'client-diagnostics:{user.id}', 10, 3600)
    db.add(ServiceEvent(area=f'client:{payload.code}:{payload.version}:{payload.page}', status=500))
    db.commit()


@router.get('/api/health/ready')
def readiness(db=Depends(get_db)):
    db.execute(text('SELECT 1'))
    jobs = job_status(db)
    ready = not IS_EPHEMERAL_VERCEL_SQLITE and all(row['healthy'] is not False for row in jobs.values())
    return JSONResponse({'ok': ready}, status_code=200 if ready else 503,
                        headers={'Cache-Control': 'no-store'})
