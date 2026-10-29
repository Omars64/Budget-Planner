"""Database-free operational paths and fenced scheduler request lifetimes."""
from contextvars import ContextVar
import hmac
import logging
import os
import time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import MutableHeaders
from starlette.requests import Request
from starlette.responses import JSONResponse

from . import resource_control as control
from .auth_dependency import current_user

scheduler_authorized = ContextVar('scheduler_authorized', default=False)

router = APIRouter()
SCHEDULER = '/api/maintenance/scheduled-transactions'
SIDE_EFFECT_READS = {'/api/auth/me', '/api/planned-transactions',
                     '/api/maintenance/daily', '/api/maintenance/update-check',
                     '/api/wallets', '/api/transactions', '/api/budgets',
                     '/api/dashboard', '/api/analytics', '/api/calendar',
                     '/api/shared/transactions'}


def resource_admin(user=Depends(current_user)):
    if user.role != 'admin':
        raise HTTPException(403, 'Administrator access required')
    return user


class Policy(BaseModel):
    model_config = ConfigDict(extra='forbid')
    scheduler_enabled: StrictBool = True
    scheduler_interval_minutes: StrictInt = Field(default=1, ge=1, le=60)
    client_poll_seconds: StrictInt = Field(ge=15, le=300)
    idle_recheck_minutes: StrictInt = Field(ge=15, le=1440)
    database_probe_minutes: StrictInt = Field(ge=15, le=1440)


class PolicyUpdate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    policy: Policy
    revision: str = Field(min_length=1, max_length=200)


@router.get('/api/admin/resource-policy')
def resource_policy(_=Depends(resource_admin)):
    return control.read_state()


@router.put('/api/admin/resource-policy')
def save_resource_policy(body: PolicyUpdate, _=Depends(resource_admin)):
    try:
        return control.update_policy(body.policy.model_dump(exclude_unset=True), body.revision)
    except control.ConflictError:
        raise HTTPException(409, 'Settings changed. Reload before saving again.') from None
    except control.CoordinationUnavailable:
        raise HTTPException(503, 'Resource settings are temporarily unavailable.') from None


def prepare(request):
    """Runs before application middleware or dependency/database initialization."""
    path, method = request.url.path, request.method
    if path == '/api/health/live' and method == 'GET':
        return JSONResponse({'ok': True})
    if path == '/api/runtime-policy' and method == 'GET':
        state = control.read_state()
        return JSONResponse({'client_poll_seconds': state['policy']['client_poll_seconds']})
    if path == SCHEDULER and method == 'POST':
        secret = os.getenv('SCHEDULE_RUNNER_SECRET', '')
        if not secret or not hmac.compare_digest(request.headers.get('Authorization', ''), 'Bearer ' + secret):
            return JSONResponse({'detail': 'Unauthorized'}, status_code=401)
    if not control.configured() or not path.startswith('/api/'):
        return None
    if path == '/api/health/ready' and method == 'GET':
        request.state.resource_health_started = time.time()
        health = control.read_health(request.state.resource_health_started)
        if health['cached']:
            return JSONResponse({'ok': health['ok']}, status_code=200 if health['ok'] else 503,
                                headers={'X-Budgetly-Readiness-Source': 'cached', 'Cache-Control': 'no-store'})
        request.state.resource_health_probe = True
        request.state.resource_health_generation = health.get('generation')
    elif path == SCHEDULER and method == 'POST':
        claim = control.claim_scheduler(time.time())
        if claim['action'] in ('skip', 'busy'):
            return JSONResponse({'ok': True, 'skipped': True, 'reason': claim.get('reason', claim['action'])})
        if claim['action'] == 'fallback':
            return JSONResponse({'detail': 'Scheduler coordination unavailable',
                                 'code': 'COORDINATION_UNAVAILABLE'}, status_code=503)
        request.state.resource_claim = claim
    elif path == '/api/admin/resource-policy' and method == 'PUT':
        # The atomic policy CAS already invalidates generation; it never writes
        # financial schedules, and must not report its own pending-save token.
        pass
    elif method in ('POST', 'PUT', 'PATCH', 'DELETE') or (method == 'GET' and
            (path in SIDE_EFFECT_READS or (path.startswith('/api/') and path.endswith('/callback')))):
        try:
            request.state.resource_change = control.begin_change()
        except control.CoordinationUnavailable:
            return JSONResponse({'detail': 'Saving is temporarily unavailable. Your change has not been submitted; please retry.',
                                 'code': 'COORDINATION_UNAVAILABLE'}, status_code=503,
                                headers={'Retry-After': '30'})
    return None


def finish(request, status):
    # Pending tokens have no TTL: a crashed or unconfirmed writer cannot hide a
    # committed schedule behind an idle marker. Each request removes only its own.
    token = getattr(request.state, 'resource_change', None)
    if token:
        try:
            control.end_change(token)
        except control.CoordinationUnavailable:
            logging.getLogger('flowbudget').warning('Resource change confirmation pending')
    claim = getattr(request.state, 'resource_claim', None)
    if claim:
        try:
            control.finish_scheduler(claim, getattr(request.state, 'resource_next_epoch', None),
                status < 400 and getattr(request.state, 'resource_scheduler_success', False), time.time())
        except control.CoordinationUnavailable:
            logging.getLogger('flowbudget').warning('Scheduler resource confirmation unavailable')
    if getattr(request.state, 'resource_health_probe', False):
        try:
            control.save_health(status == 200, request.state.resource_health_started,
                                getattr(request.state, 'resource_health_generation', None))
        except control.CoordinationUnavailable:
            logging.getLogger('flowbudget').warning('Resource health confirmation unavailable')


class ResourceMiddleware:
    """Pure ASGI wrapper: cleanup follows response and dependency teardown."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        request = Request(scope, receive)
        response = await run_in_threadpool(prepare, request)
        if response is not None:
            response.headers.update({'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
                                     'Referrer-Policy': 'same-origin'})
            return await response(scope, receive, send)
        status = 500
        readiness = request.method == 'GET' and request.url.path == '/api/health/ready'

        async def capture(message):
            nonlocal status
            if message['type'] == 'http.response.start':
                status = message['status']
                if readiness:
                    # This identifies the uncached path, not a successful DB connection.
                    headers = MutableHeaders(scope=message)
                    headers['X-Budgetly-Readiness-Source'] = 'probe'
                    headers['Cache-Control'] = 'no-store'
            await send(message)

        authorization = scheduler_authorized.set(bool(getattr(request.state, 'resource_claim', None)))
        try:
            await self.app(scope, receive, capture)
        except BaseException:
            status = 500
            raise
        finally:
            scheduler_authorized.reset(authorization)
            await run_in_threadpool(finish, request, status)
