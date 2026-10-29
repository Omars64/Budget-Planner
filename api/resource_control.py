"""Durable operational coordination, independent of the application database.

Public functions mirror Coordinator methods. Inject ``executor(command_array)``
to test without HTTP; it must return the Redis result (not its REST envelope).
``environ`` accepts an explicit mapping; the module singleton resolves os.environ
on each call, so an unconfigured process never suppresses future store reads.

Call begin_change BEFORE any database mutation and end_change AFTER commit or
rollback. An unconfirmed begin must reject the mutation. A failed end deliberately
leaves a permanent pending token: recovery requires investigation, never a TTL.
Authenticate cron before claim_scheduler; always finish a run in a finally block.
Health callers perform an actual database readiness query when needs_probe is true
and pass that read_health response's generation to save_health with the result.
The save_health timestamp must be captured at probe START, before the DB query.
The generation is internal middleware state; omit it from public responses.
Duplicate probes are intentionally allowed.
New/reset coordination state drains for 600 seconds from its first scheduler
claim before permitting skips or publishing idle markers. Pending tokens remain
persistent throughout; the drain also covers writers under a retired namespace.
No account/financial data or provider error text is stored or returned.

read_state returns {policy, revision, coordination: {configured, healthy}, status}.
Status contains only pending_count and optional epoch timestamps last_tick,
last_run, last_skip, last_success, last_failure and global runs/skips counters.
The unavailable revision is a sentinel, never an accepted offline CAS revision.
All write methods raise CoordinationUnavailable when confirmation fails. A
caller must not treat read_state's fallback policy as permission for DB writes.
"""

import hashlib
import json
import math
import os
from urllib.parse import urlsplit
from uuid import uuid4

import httpx


DEFAULT_POLICY = {
    "scheduler_enabled": True,
    "scheduler_interval_minutes": 1,
    "client_poll_seconds": 60,
    "idle_recheck_minutes": 180,
    "database_probe_minutes": 60,
}
POLICY_BOUNDS = {
    "scheduler_interval_minutes": (1, 60),
    "client_poll_seconds": (15, 300),
    "idle_recheck_minutes": (15, 1440),
    "database_probe_minutes": (15, 1440),
}
DATABASE_URL_KEYS = (
    "FLOWBUDGET_DATABASE_URL", "FLOWBUDGET_POSTGRES_URL", "DATABASE_URL",
    "FLOWBUDGET_URL", "POSTGRES_URL", "FLOWBUDGET_DATABASE_URL_UNPOOLED",
    "DATABASE_URL_UNPOOLED", "FLOWBUDGET_URL_UNPOOLED",
)
HEALTH_CONFIGURATION_KEYS = (
    "BACKUP_S3_BUCKET", "BACKUP_S3_REGION", "BACKUP_S3_ACCESS_KEY_ID",
    "BACKUP_S3_SECRET_ACCESS_KEY", "BACKUP_ENCRYPTION_KEY", "BACKUP_S3_ENDPOINT_URL",
    "SCHEDULE_RUNNER_SECRET", "VERCEL_DEPLOYMENT_ID", "VERCEL_URL",
)


def _database_url(env):
    return next((env[key] for key in DATABASE_URL_KEYS if env.get(key, "").strip()), "")


class CoordinationUnavailable(RuntimeError):
    """A durable transition could not be confirmed; do not retry blindly."""


class ConflictError(RuntimeError):
    """Policy revision changed. Fetch state before submitting again."""

    status_code = 409


def _policy(value):
    required = set(POLICY_BOUNDS) - {'scheduler_interval_minutes'}
    allowed = set(DEFAULT_POLICY)
    if not isinstance(value, dict) or not required <= value.keys() or not value.keys() <= allowed:
        raise ValueError("A complete resource policy is required")
    for key, (low, high) in POLICY_BOUNDS.items():
        if key in value and (type(value[key]) is not int or not low <= value[key] <= high):
            raise ValueError("Invalid resource policy: " + key)
    if 'scheduler_enabled' in value and type(value['scheduler_enabled']) is not bool:
        raise ValueError("Invalid resource policy: scheduler_enabled")
    return dict(value)


def _epoch(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("Expected a finite epoch timestamp")
    if not math.isfinite(value) or value < 0:
        raise ValueError("Expected a finite epoch timestamp")
    return value


# All keys share one Redis cluster slot. Generation combines a reset nonce with
# an INCR counter, preventing ABA even if the counter is lost or reset.
LUA = r'''
local op, nonce = ARGV[1], ARGV[2]
local epoch, gen, policy, revision, marker, lease, pending, health, status = unpack(KEYS)
local function decode(raw)
    if not raw then return nil end
    local ok, value = pcall(cjson.decode, raw)
    if ok and type(value) == 'table' then return value end
    return nil
end
local counter = redis.call('GET', gen)
if not counter or not string.match(counter, '^%d+$') or not redis.call('GET', epoch) then
    redis.call('SET', epoch, nonce)
    redis.call('SET', gen, '0')
    redis.call('DEL', marker, lease, health)
    redis.call('HSET', status, 'warmup_pending', '1')
    redis.call('HDEL', status, 'warmup_until')
end
local function generation()
    return redis.call('GET', epoch) .. ':' .. redis.call('GET', gen)
end
local function invalidate()
    redis.call('INCR', gen)
    redis.call('DEL', marker, health)
end
local actual_pending = redis.call('SCARD', pending)
local expected_pending = tonumber(redis.call('HGET', status, 'pending_writers')) or 0
if actual_pending ~= expected_pending then
    -- A missing set must not turn an in-flight financial writer into idle state.
    invalidate()
    redis.call('HSET', status, 'warmup_pending', '1')
    redis.call('HDEL', status, 'warmup_until')
    redis.call('HSET', status, 'pending_writers', actual_pending)
end
local p = decode(redis.call('GET', policy))
if not p then
    if redis.call('EXISTS', policy) == 1 then return redis.error_reply('invalid policy') end
    p = {client_poll_seconds=60, idle_recheck_minutes=180, database_probe_minutes=60}
end
if p.scheduler_enabled == nil then p.scheduler_enabled = true end
if p.scheduler_interval_minutes == nil then p.scheduler_interval_minutes = 1 end
if type(p.scheduler_enabled) ~= 'boolean' then return redis.error_reply('invalid policy') end
local bounds = {scheduler_interval_minutes={1,60}, client_poll_seconds={15,300}, idle_recheck_minutes={15,1440}, database_probe_minutes={15,1440}}
for k, b in pairs(bounds) do
    local v = p[k]
    if type(v) ~= 'number' or v ~= math.floor(v) or v < b[1] or v > b[2] then
        return redis.error_reply('invalid policy')
    end
end
if not redis.call('GET', revision) then redis.call('SET', revision, nonce) end
local function snapshot()
    local s = {pending_count=redis.call('SCARD', pending)}
    for _, k in ipairs({'last_tick','last_run','last_skip','last_success','last_failure','runs','skips'}) do
        local v = tonumber(redis.call('HGET', status, k))
        if v then s[k] = v end
    end
    return cjson.encode({policy=p, revision=redis.call('GET', revision),
        coordination={configured=true, healthy=true}, status=s})
end
if op == 'state' then return snapshot() end
if op == 'policy' then
    if redis.call('GET', revision) ~= ARGV[3] then return 'conflict' end
    local updated = decode(ARGV[4])
    if not updated then return redis.error_reply('invalid policy') end
    for k, v in pairs(updated) do
        if k ~= 'scheduler_enabled' and not bounds[k] then return redis.error_reply('invalid policy') end
    end
    for k, b in pairs(bounds) do
        local v = updated[k]
        if v == nil and k == 'scheduler_interval_minutes' then v = p[k] end
        if type(v) ~= 'number' or v ~= math.floor(v) or v < b[1] or v > b[2] then
            return redis.error_reply('invalid policy')
        end
        updated[k] = v
    end
    if updated.scheduler_enabled == nil then updated.scheduler_enabled = p.scheduler_enabled end
    if type(updated.scheduler_enabled) ~= 'boolean' then return redis.error_reply('invalid policy') end
    redis.call('SET', policy, cjson.encode(updated))
    redis.call('SET', revision, nonce)
    p = updated
    invalidate()
    return snapshot()
end
if op == 'begin' then
    if redis.call('SADD', pending, nonce) == 1 then
        redis.call('HINCRBY', status, 'pending_writers', 1)
    end
    redis.call('PERSIST', pending)
    invalidate()
    return nonce
end
if op == 'end' then
    if redis.call('SREM', pending, ARGV[3]) == 1 then
        redis.call('HINCRBY', status, 'pending_writers', -1)
    end
    invalidate()
    return 'ok'
end
local now = tonumber(ARGV[3])
if op == 'claim' then
    redis.call('HSET', status, 'last_tick', now)
    if redis.call('EXISTS', lease) == 1 then return cjson.encode({action='busy'}) end
    local last_run = tonumber(redis.call('HGET', status, 'last_run'))
    local reason = nil
    if not p.scheduler_enabled then reason = 'paused'
    elseif last_run and now < last_run + p.scheduler_interval_minutes * 60 then reason = 'interval' end
    if reason then
        redis.call('HINCRBY', status, 'skips', 1)
        redis.call('HSET', status, 'last_skip', now)
        return cjson.encode({action='skip', reason=reason})
    end
    local warmup_until = tonumber(redis.call('HGET', status, 'warmup_until'))
    if redis.call('HGET', status, 'warmup_pending') or not warmup_until then
        warmup_until = now + 600
        redis.call('HSET', status, 'warmup_until', warmup_until)
        redis.call('HDEL', status, 'warmup_pending')
        redis.call('DEL', marker)
    end
    local g = generation()
    local m = decode(redis.call('GET', marker))
    if now >= warmup_until and redis.call('SCARD', pending) == 0 and m and m.generation == g
        and type(m.next_at) == 'number' and m.next_at > now
        and m.next_at <= now + p.idle_recheck_minutes * 60 then
        redis.call('HINCRBY', status, 'skips', 1)
        redis.call('HSET', status, 'last_skip', now)
        return cjson.encode({action='skip'})
    end
    local acquired = redis.call('SET', lease, nonce, 'NX', 'EX', 180)
    if not acquired then return cjson.encode({action='busy'}) end
    redis.call('HINCRBY', status, 'runs', 1)
    redis.call('HSET', status, 'last_run', now)
    return cjson.encode({action='run', token=nonce, generation=g})
end
if op == 'finish' then
    if redis.call('GET', lease) ~= ARGV[4] then return 'stale' end
    local same = generation() == ARGV[5]
    local success = ARGV[6] == '1'
    redis.call('HSET', status, 'last_result', ARGV[6],
        success and 'last_success' or 'last_failure', now)
    local warmup_until = tonumber(redis.call('HGET', status, 'warmup_until'))
    local drained = warmup_until and now >= warmup_until
        and not redis.call('HGET', status, 'warmup_pending')
    if same and drained and redis.call('SCARD', pending) == 0 then
        local cap = now + p.idle_recheck_minutes * 60
        local next_at = math.min(tonumber(ARGV[7]) or cap, cap)
        if not success then next_at = math.min(next_at, now + 60) end
        redis.call('SET', marker, cjson.encode({generation=generation(), next_at=next_at}))
    else
        redis.call('DEL', marker)
    end
    redis.call('DEL', lease)
    return 'ok'
end
if op == 'health' then
    local h = decode(redis.call('GET', health))
    local g = generation()
    local cached = redis.call('SCARD', pending) == 0
        and h and h.generation == g and type(h.ok) == 'boolean'
        and type(h.checked_at) == 'number' and h.checked_at <= now
        and type(h.expires_at) == 'number' and h.expires_at > now
        and h.expires_at <= h.checked_at + (h.ok and p.database_probe_minutes * 60 or 60)
    local ok = cached and h.ok or false
    if ARGV[4] == '1' and p.scheduler_enabled then
        local tick = tonumber(redis.call('HGET', status, 'last_tick'))
        if not tick or tick > now or now - tick > 300
            or redis.call('HGET', status, 'last_result') == '0' then ok = false end
    end
    local result = {cached=not not cached, ok=not not ok, needs_probe=not cached}
    if not cached then result.generation = g end
    return cjson.encode(result)
end
if op == 'save_health' then
    if not ARGV[5] or ARGV[5] == '' or ARGV[5] ~= generation()
        or redis.call('SCARD', pending) ~= 0 then return 'stale' end
    local previous = decode(redis.call('GET', health))
    if previous and previous.generation == ARGV[5]
        and type(previous.checked_at) == 'number' and previous.checked_at > now then
        return 'stale'
    end
    local ok = ARGV[4] == '1'
    local seconds = ok and p.database_probe_minutes * 60 or 60
    redis.call('SET', health, cjson.encode({ok=ok, checked_at=now,
        expires_at=now+seconds, generation=generation()}), 'EX', seconds)
    return 'ok'
end
return redis.error_reply('unknown operation')
'''


class Coordinator:
    """Redis coordinator; executor receives one EVAL command per operation.

    Deployment isolation requires an explicit namespace outside production
    (including local use). Keys additionally hash APP_SECRET and database hostname;
    Only the health key additionally hashes backup/cron configuration, the full
    selected database URL and deployment identity. Coordination survives deploys.
    No URL, secret, namespace text, or identifier appears in public state.
    """

    def __init__(self, executor=None, environ=None):
        self._executor = executor
        self._environ = environ

    def _configuration(self):
        env = os.environ if self._environ is None else self._environ
        if env.get("BUDGETLY_RESOURCE_OPTIMIZATION") == "0":
            return None
        url = token = None
        for prefix in ("UPSTASH_REDIS_REST", "KV_REST_API"):
            if env.get(prefix + "_URL") and env.get(prefix + "_TOKEN"):
                url, token = env[prefix + "_URL"], env[prefix + "_TOKEN"]
                break
        namespace = env.get("BUDGETLY_COORDINATION_NAMESPACE", "").strip()
        if not url or (env.get("VERCEL_ENV") != "production" and not namespace):
            return None
        try:
            parsed = urlsplit(url)
            if (parsed.scheme != "https" or not parsed.hostname or parsed.username
                    or parsed.password or parsed.query or parsed.fragment
                    or parsed.path not in ("", "/")):
                return None
            database = _database_url(env)
            host = urlsplit(database).hostname or "local"
        except ValueError:
            return None
        identity = json.dumps([env.get("VERCEL_ENV", "local"), namespace or "production",
                               env.get("APP_SECRET", ""), host.lower()])
        digest = hashlib.sha256(identity.encode()).hexdigest()
        return url.rstrip("/"), token, "budgetly:resource:{" + digest + "}:"

    def _health_key(self, prefix):
        env = os.environ if self._environ is None else self._environ
        identity = json.dumps([_database_url(env),
                               [env.get(key, "") for key in HEALTH_CONFIGURATION_KEYS]])
        return prefix + "health:" + hashlib.sha256(identity.encode()).hexdigest()

    def configured(self) -> bool:
        """True only with enabled credentials and safe deployment isolation."""
        return self._configuration() is not None

    def _call(self, operation, *args):
        config = self._configuration()
        if config is None:
            raise CoordinationUnavailable("Resource coordination unavailable")
        url, token, prefix = config
        keys = [prefix + name for name in (
            "epoch", "generation", "policy", "revision", "marker", "lease",
            "pending", "health", "status",
        )]
        keys[7] = self._health_key(prefix)
        command = ["EVAL", LUA, len(keys), *keys, operation, str(uuid4()), *args]
        try:
            if self._executor is not None:
                return self._executor(command)
            # No retries: a timeout may mean that the atomic write already ran.
            response = httpx.post(url, json=command, headers={
                "Authorization": "Bearer " + token,
            }, timeout=2.0, follow_redirects=False)
            response.raise_for_status()
            envelope = response.json()
            if not isinstance(envelope, dict) or "error" in envelope or "result" not in envelope:
                raise ValueError("Invalid response")
            return envelope["result"]
        except Exception:
            raise CoordinationUnavailable("Resource coordination unavailable") from None

    @staticmethod
    def _object(raw):
        try:
            result = json.loads(raw)
            if not isinstance(result, dict):
                raise ValueError()
            return result
        except (ValueError, TypeError):
            raise CoordinationUnavailable("Invalid coordination response") from None

    def _state(self, raw):
        value = self._object(raw)
        try:
            policy = {**DEFAULT_POLICY, **_policy(value["policy"])}
            revision = value["revision"]
            if not isinstance(revision, str) or not revision:
                raise ValueError()
            status = value["status"]
            public = {}
            for key in ("pending_count", "last_tick", "last_run", "last_skip",
                        "last_success", "last_failure", "runs", "skips"):
                if key in status:
                    public[key] = _epoch(status[key])
            if "pending_count" not in public:
                raise ValueError()
            return {"policy": policy, "revision": revision,
                    "coordination": {"configured": True, "healthy": True}, "status": public}
        except (KeyError, TypeError, ValueError):
            raise CoordinationUnavailable("Invalid coordination response") from None

    def read_state(self) -> dict:
        """Public policy/revision and allowlisted operational counts/timestamps."""
        try:
            return self._state(self._call("state"))
        except CoordinationUnavailable:
            return {"policy": dict(DEFAULT_POLICY), "revision": "unavailable",
                    "coordination": {"configured": self.configured(), "healthy": False},
                    "status": {"pending_count": 0}}

    def update_policy(self, policy: dict, revision: str) -> dict:
        """Validate policy then atomically merge optional scheduler fields under CAS."""
        policy = _policy(policy)
        if not isinstance(revision, str) or not revision:
            raise ValueError("A policy revision is required")
        result = self._call("policy", revision, json.dumps(policy))
        if result == "conflict":
            raise ConflictError("Resource policy changed")
        return self._state(result)

    def claim_scheduler(self, now_epoch: float) -> dict:
        """Return run (+token/generation), skip, busy, or fail-open fallback.

        First runnable claim after initialization/reset starts a 600s drain;
        idle skips/markers are forbidden during it. Explicit pause/interval
        skips still apply and never clear pending writers.
        """
        now_epoch = _epoch(now_epoch)
        try:
            claim = self._object(self._call("claim", now_epoch))
            if claim.get("action") not in ("run", "skip", "busy"):
                raise CoordinationUnavailable("Invalid coordination response")
            if claim["action"] == "run":
                if not all(isinstance(claim.get(k), str) and claim[k] for k in ("token", "generation")):
                    raise CoordinationUnavailable("Invalid coordination response")
                return {k: claim[k] for k in ("action", "token", "generation")}
            result = {"action": claim["action"]}
            if claim.get('reason') in ('paused', 'interval'):
                result['reason'] = claim['reason']
            return result
        except CoordinationUnavailable:
            return {"action": "fallback"}

    def finish_scheduler(self, claim: dict, next_epoch_or_None: float | None,
                         success: bool, now_epoch: float) -> None:
        """Publish only under owned live lease, same generation, no pending writer.

        Stale claims are harmless. Reset drain prevents marker publication.
        Failure retries within 60s; success is capped
        by idle policy. Transport failures raise CoordinationUnavailable.
        """
        now_epoch = _epoch(now_epoch)
        if next_epoch_or_None is not None:
            _epoch(next_epoch_or_None)
        if type(success) is not bool:
            raise ValueError("success must be a bool")
        if claim.get("action") != "run":
            return
        if not all(isinstance(claim.get(k), str) and claim[k] for k in ("token", "generation")):
            raise ValueError("Invalid scheduler claim")
        result = self._call("finish", now_epoch, claim["token"], claim["generation"],
                            "1" if success else "0",
                            "" if next_epoch_or_None is None else next_epoch_or_None)
        if result not in ("ok", "stale"):
            raise CoordinationUnavailable("Invalid coordination response")

    def begin_change(self) -> str:
        """Confirm a permanent pending token BEFORE database writes, or raise."""
        token = self._call("begin")
        try:
            from uuid import UUID
            UUID(token)
        except (ValueError, TypeError, AttributeError):
            raise CoordinationUnavailable("Invalid coordination response") from None
        return token

    def end_change(self, token: str) -> None:
        """Remove only this writer's token after commit/rollback; never auto-clear."""
        if not isinstance(token, str) or not token:
            raise ValueError("A mutation token is required")
        if self._call("end", token) != "ok":
            raise CoordinationUnavailable("Invalid coordination response")

    def read_health(self, now_epoch: float) -> dict:
        """Cache actual DB readiness only; overdue/failed authenticated cron vetoes ok.

        needs_probe requests a real DB check. Cron veto can return cached=True,
        ok=False, needs_probe=False: a DB probe cannot repair a stalled cron.
        A store-confirmed needs_probe response includes an opaque generation to
        pass to save_health after the probe. Keep it out of public responses.
        """
        now_epoch = _epoch(now_epoch)
        env = os.environ if self._environ is None else self._environ
        try:
            value = self._object(self._call("health", now_epoch,
                                 "1" if env.get("SCHEDULE_RUNNER_SECRET") else "0"))
            if not all(type(value.get(k)) is bool for k in ("cached", "ok", "needs_probe")):
                raise CoordinationUnavailable("Invalid coordination response")
            result = {k: value[k] for k in ("cached", "ok", "needs_probe")}
            if value["needs_probe"] and "generation" in value:
                generation = value["generation"]
                if not isinstance(generation, str) or not generation:
                    raise CoordinationUnavailable("Invalid coordination response")
                result["generation"] = generation
            return result
        except CoordinationUnavailable:
            return {"cached": False, "ok": False, "needs_probe": True}

    def save_health(self, ok: bool, now_epoch: float, generation: str | None = None) -> None:
        """Cache actual readiness only under its probe-start generation, no writers.

        now_epoch MUST be the probe start time, captured before any DB I/O, not
        the completion/cleanup time. Expiration is anchored to this start time.
        Older probes cannot overwrite a newer result in the same generation.
        Pass read_health's generation captured before the DB probe. Missing or
        stale generations are harmless no-ops and never overwrite newer health.
        Negative results expire in 60s. Provider failures still raise.
        """
        if type(ok) is not bool:
            raise ValueError("ok must be a bool")
        if generation is not None and (not isinstance(generation, str) or not generation):
            raise ValueError("generation must be a nonempty string or None")
        result = self._call("save_health", _epoch(now_epoch), "1" if ok else "0", generation or "")
        if result not in ("ok", "stale"):
            raise CoordinationUnavailable("Invalid coordination response")


_coordinator = Coordinator()
configured = _coordinator.configured
read_state = _coordinator.read_state
update_policy = _coordinator.update_policy
claim_scheduler = _coordinator.claim_scheduler
finish_scheduler = _coordinator.finish_scheduler
begin_change = _coordinator.begin_change
end_change = _coordinator.end_change
read_health = _coordinator.read_health
save_health = _coordinator.save_health
