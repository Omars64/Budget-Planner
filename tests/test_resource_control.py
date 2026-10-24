"""Synthetic credentials only; no app import, production service or secret reads.

Run: python -m pytest --noconftest tests/test_resource_control.py
Lua state-machine cases execute the production scripts through fakeredis/lupa
entirely in memory. Install requirements-dev.txt first; missing Lua support fails
the suite instead of skipping atomic safety checks. No runtime network is used.
"""

import importlib.util
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import socket
from threading import Barrier
import time

import fakeredis
import httpx
import pytest


_spec = importlib.util.spec_from_file_location(
    "isolated_resource_control", Path(__file__).parents[1] / "api" / "resource_control.py")
rc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rc)

NOW = 1_800_000_000


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    def blocked(*args, **kwargs):
        pytest.fail("Resource control tests attempted network I/O")
    monkeypatch.setattr(socket.socket, "connect", blocked)
    monkeypatch.setattr(socket.socket, "connect_ex", blocked)
    monkeypatch.setattr(socket, "create_connection", blocked)
    monkeypatch.setattr(socket, "getaddrinfo", blocked)
    monkeypatch.setattr(rc.httpx, "post", blocked)


def environment(**changes):
    env = {
        "UPSTASH_REDIS_REST_URL": "https://synthetic.upstash.io",
        "UPSTASH_REDIS_REST_TOKEN": "synthetic-bearer",
        "APP_SECRET": "synthetic-app-secret",
        "FLOWBUDGET_DATABASE_URL": "postgresql://fake:fake@db.example.test/budget",
        "VERCEL_ENV": "production",
    }
    env.update(changes)
    return env


def coordinator(executor=None, **changes):
    return rc.Coordinator(executor=executor, environ=environment(**changes))


def snapshot(**changes):
    state = {"policy": dict(rc.DEFAULT_POLICY), "revision": "synthetic-revision",
             "coordination": {"configured": True, "healthy": True},
             "status": {"pending_count": 0}}
    state.update(changes)
    return json.dumps(state)


@pytest.mark.parametrize("env,expected", [
    ({}, False),
    (environment(), True),
    (environment(BUDGETLY_RESOURCE_OPTIMIZATION="0"), False),
    (environment(VERCEL_ENV="preview"), False),
    (environment(VERCEL_ENV="development"), False),
    (environment(VERCEL_ENV=""), False),
    (environment(VERCEL_ENV="preview", BUDGETLY_COORDINATION_NAMESPACE="test-branch"), True),
    (environment(UPSTASH_REDIS_REST_TOKEN=""), False),
    (environment(UPSTASH_REDIS_REST_URL="http://localhost"), False),
    (environment(UPSTASH_REDIS_REST_URL="https://host.test/?_token=secret"), False),
    (environment(UPSTASH_REDIS_REST_URL="https://secret@host.test"), False),
    (environment(UPSTASH_REDIS_REST_URL="https://host.test/command"), False),
    (environment(UPSTASH_REDIS_REST_URL="", UPSTASH_REDIS_REST_TOKEN="",
                 KV_REST_API_URL="https://kv.test", KV_REST_API_TOKEN="test"), True),
    (environment(UPSTASH_REDIS_REST_URL="", KV_REST_API_URL="https://kv.test"), False),
])
def test_configuration(env, expected):
    assert rc.Coordinator(environ=env).configured() is expected


def test_unconfigured_does_not_call_executor_and_never_suppresses_later_store():
    env = {}
    calls = []
    c = rc.Coordinator(lambda cmd: calls.append(cmd) or snapshot(), env)
    assert c.read_state() == {
        "policy": rc.DEFAULT_POLICY, "revision": "unavailable",
        "coordination": {"configured": False, "healthy": False}, "status": {"pending_count": 0}}
    assert c.claim_scheduler(NOW) == {"action": "fallback"}
    with pytest.raises(rc.CoordinationUnavailable):
        c.begin_change()
    assert not calls
    env.update(environment())
    assert c.read_state()["coordination"]["healthy"] is True
    assert len(calls) == 1


def test_namespaces_isolate_environment_secret_and_database_host():
    def keys(**changes):
        commands = []
        coordinator(lambda cmd: commands.append(cmd) or snapshot(), **changes).read_state()
        return commands[0][3:12]
    original = keys()
    assert original != keys(APP_SECRET="another-synthetic-secret")
    assert original != keys(FLOWBUDGET_DATABASE_URL="postgresql://fake@other.test/budget")
    assert original != keys(BUDGETLY_COORDINATION_NAMESPACE="review")
    assert keys(BUDGETLY_COORDINATION_NAMESPACE="review") != keys(
        VERCEL_ENV="preview", BUDGETLY_COORDINATION_NAMESPACE="review")
    changed = keys(FLOWBUDGET_DATABASE_URL="postgresql://new:password@db.example.test/other")
    assert original[:7] + original[8:] == changed[:7] + changed[8:]
    assert original[7] != changed[7]
    assert len({key.split("{")[1].split("}")[0] for key in original}) == 1
    assert not any(word in " ".join(original) for word in ("secret", "example.test", "postgresql"))


def test_http_post_array_bearer_timeout_and_no_redirects(monkeypatch):
    calls = []
    def post(url, **kwargs):
        calls.append((url, kwargs))
        return httpx.Response(200, json={"result": snapshot()}, request=httpx.Request("POST", url))
    monkeypatch.setattr(rc.httpx, "post", post)
    assert coordinator().read_state()["coordination"]["healthy"]
    url, kwargs = calls[0]
    assert url == "https://synthetic.upstash.io"
    assert kwargs["headers"] == {"Authorization": "Bearer synthetic-bearer"}
    assert kwargs["timeout"] == 2.0
    assert kwargs["follow_redirects"] is False
    assert kwargs["json"][:3] == ["EVAL", rc.LUA, 9]
    assert kwargs["json"][12] == "state"
    assert "synthetic-bearer" not in json.dumps(kwargs["json"])


@pytest.mark.parametrize("failure", ["timeout", "status", "error", "invalid", "missing", "badjson"])
def test_ambiguous_begin_never_retries_or_exposes_provider_content(monkeypatch, failure):
    calls = []
    def post(url, **kwargs):
        calls.append(kwargs)
        if failure == "timeout":
            raise httpx.ReadTimeout("secret provider payload")
        values = {"error": {"error": "secret provider payload"}, "invalid": [], "missing": {}}
        return httpx.Response(
            500 if failure == "status" else 200,
            content=b"secret provider payload" if failure == "badjson" else None,
            json=values.get(failure) if failure != "badjson" else None,
            request=httpx.Request("POST", url))
    monkeypatch.setattr(rc.httpx, "post", post)
    with pytest.raises(rc.CoordinationUnavailable) as error:
        coordinator().begin_change()
    assert len(calls) == 1
    assert "secret" not in str(error.value)
    assert error.value.__suppress_context__


def test_provider_failures_and_default_policy():
    def broken(_):
        raise RuntimeError("secret provider payload")
    c = coordinator(broken)
    assert c.claim_scheduler(NOW) == {"action": "fallback"}
    assert c.read_state()["policy"] == rc.DEFAULT_POLICY
    assert c.read_state()["coordination"] == {"configured": True, "healthy": False}
    assert c.read_health(NOW) == {"cached": False, "ok": False, "needs_probe": True}
    claim = {"action": "run", "token": "opaque", "generation": "epoch:1"}
    for operation in (c.begin_change, lambda: c.end_change("opaque"),
                      lambda: c.update_policy(rc.DEFAULT_POLICY, "old"),
                      lambda: c.save_health(True, NOW),
                      lambda: c.finish_scheduler(claim, None, True, NOW)):
        with pytest.raises(rc.CoordinationUnavailable):
            operation()


@pytest.mark.parametrize("key,value", [
    ("client_poll_seconds", 14), ("client_poll_seconds", 301),
    ("idle_recheck_minutes", 14), ("idle_recheck_minutes", 1441),
    ("database_probe_minutes", 14), ("database_probe_minutes", 1441),
    ("client_poll_seconds", True), ("client_poll_seconds", 60.0),
    ("client_poll_seconds", "60"), ("database_probe_minutes", None),
])
def test_strict_policy_validation_before_transport(key, value):
    p = dict(rc.DEFAULT_POLICY, **{key: value})
    with pytest.raises(ValueError):
        coordinator(lambda _: pytest.fail("invalid policy reached transport")).update_policy(p, "r")


@pytest.mark.parametrize("policy", [{}, dict(rc.DEFAULT_POLICY, extra=1), None, []])
def test_policy_requires_exact_complete_keys(policy):
    with pytest.raises(ValueError):
        coordinator().update_policy(policy, "r")


def test_policy_cas_and_public_allowlist():
    with pytest.raises(rc.ConflictError) as error:
        coordinator(lambda _: "conflict").update_policy(rc.DEFAULT_POLICY, "stale")
    assert error.value.status_code == 409
    c = coordinator(lambda _: snapshot(status={"pending_count": 2, "runs": 3, "token": "private"},
                                      private="private"))
    result = c.update_policy(rc.DEFAULT_POLICY, "revision")
    assert result["status"] == {"pending_count": 2, "runs": 3}
    assert "private" not in json.dumps(result)


@pytest.mark.parametrize("value", [15, 300])
def test_policy_accepts_client_bounds(value):
    policy = dict(rc.DEFAULT_POLICY, client_poll_seconds=value)
    assert coordinator(lambda _: snapshot(policy=policy)).update_policy(policy, "r")["policy"] == policy


@pytest.mark.parametrize("value", [15, 1440])
def test_policy_accepts_minute_bounds(value):
    policy = dict(rc.DEFAULT_POLICY, idle_recheck_minutes=value, database_probe_minutes=value)
    assert coordinator(lambda _: snapshot(policy=policy)).update_policy(policy, "r")["policy"] == policy


def test_successful_api_arguments_and_non_run_finish():
    commands = []
    def execute(command):
        commands.append(command)
        operation, nonce = command[12:14]
        if operation == "begin":
            return nonce
        if operation == "claim":
            return json.dumps({"action": "run", "token": nonce, "generation": "opaque:1"})
        if operation == "health":
            return json.dumps({"cached": True, "ok": True, "needs_probe": False, "private": "hidden"})
        return "ok"
    c = coordinator(execute, SCHEDULE_RUNNER_SECRET="synthetic-cron-secret")
    token = c.begin_change()
    c.end_change(token)
    assert commands[-1][14:] == [token]
    run = c.claim_scheduler(NOW)
    c.finish_scheduler(run, None, True, NOW)
    assert commands[-1][14:] == [NOW, run["token"], run["generation"], "1", ""]
    c.save_health(False, NOW)
    assert commands[-1][14:] == [NOW, "0", ""]
    c.save_health(True, NOW, generation="probe-start")
    assert commands[-1][14:] == [NOW, "1", "probe-start"]
    assert c.read_health(NOW) == {"cached": True, "ok": True, "needs_probe": False}
    assert commands[-1][14:] == [NOW, "1"]
    count = len(commands)
    for action in ("fallback", "busy", "skip"):
        c.finish_scheduler({"action": action}, None, True, NOW)
    assert len(commands) == count


def test_write_acknowledgements_must_be_confirmed():
    c = coordinator(lambda _: None)
    for call in (lambda: c.end_change("opaque"), lambda: c.save_health(True, NOW),
                 lambda: c.finish_scheduler(
                     {"action": "run", "token": "opaque", "generation": "opaque:1"}, None, True, NOW)):
        with pytest.raises(rc.CoordinationUnavailable):
            call()


@pytest.mark.parametrize("raw", [None, "null", "[]", "garbage", '{}',
                                  '{"action":"run"}', '{"action":"invalid"}'])
def test_corrupt_provider_results_are_conservative(raw):
    c = coordinator(lambda _: raw)
    assert c.read_state()["coordination"]["healthy"] is False
    assert c.claim_scheduler(NOW)["action"] == "fallback"
    assert c.read_health(NOW)["needs_probe"] is True
    with pytest.raises(rc.CoordinationUnavailable):
        c.begin_change()


@pytest.mark.parametrize("now", [True, -1, float("nan"), float("inf"), "1"])
def test_invalid_timestamps_never_reach_transport(now):
    c = coordinator(lambda _: pytest.fail("invalid timestamp reached transport"))
    for operation in (c.claim_scheduler, c.read_health, lambda n: c.save_health(True, n)):
        with pytest.raises(ValueError):
            operation(now)


def test_lua_persistent_pending_and_atomic_fences():
    # Textual guardrails supplement, but do not replace, the executable cases below.
    begin = rc.LUA.split("if op == 'begin' then")[1].split("if op == 'end'")[0]
    end = rc.LUA.split("if op == 'end' then")[1].split("local now")[0]
    finish = rc.LUA.split("if op == 'finish' then")[1].split("if op == 'health'")[0]
    assert "redis.call('SADD', pending, nonce)" in begin
    assert "redis.call('PERSIST', pending)" in begin
    assert "redis.call('SREM', pending, ARGV[3])" in end
    assert "invalidate()" in begin and "invalidate()" in end
    assert "redis.call('INCR', gen)" in rc.LUA
    assert "redis.call('GET', lease) ~= ARGV[4]" in finish
    assert "generation() == ARGV[5]" in finish
    assert "same and drained and redis.call('SCARD', pending) == 0" in finish
    assert "'NX', 'EX', 180" in rc.LUA
    for line in rc.LUA.splitlines():
        if "pending" in line:
            assert "'EX'" not in line and "'EXPIRE'" not in line
            assert "'DEL', pending" not in line


@pytest.fixture
def store():
    with fakeredis.FakeRedis(decode_responses=True, version=(7, 0)) as client:
        # Fail immediately if the required Lua runtime was not installed.
        assert client.eval("return cjson.decode(ARGV[1]).value", 0, '{"value":1}') == 1
        yield lambda command: client.execute_command(*command)


@pytest.fixture
def live(store):
    c = coordinator(store)
    c.read_state()
    prefix = c._configuration()[2]
    # Most scenarios begin after drain. Dedicated cases below cover initialization.
    initial = c.claim_scheduler(NOW - 600)
    c.finish_scheduler(initial, None, True, NOW - 600)
    store(["HDEL", prefix + "status", "runs", "last_tick", "last_run", "last_success", "last_result"])
    return c, store, lambda name: c._health_key(prefix) if name == "health" else prefix + name


def test_lua_initial_claim_skip_idle_cap_and_counts(live):
    c, store, key = live
    claim = c.claim_scheduler(NOW)
    assert claim["action"] == "run"
    assert store(["TTL", key("lease")]) in (179, 180)
    assert c.claim_scheduler(NOW)["action"] == "busy"
    c.finish_scheduler(claim, NOW + 999999, True, NOW)
    assert c.claim_scheduler(NOW + 1)["action"] == "skip"
    assert c.claim_scheduler(NOW + 180 * 60)["action"] == "run"
    state = c.read_state()
    assert state["status"]["runs"] == 2
    assert state["status"]["skips"] == 1
    assert state["status"]["last_tick"] == NOW + 180 * 60


def test_lua_pending_writer_before_and_after_scheduler_finish(live):
    c, store, key = live
    claim = c.claim_scheduler(NOW)
    first, second = c.begin_change(), c.begin_change()
    assert store(["TTL", key("pending")]) == -1
    c.finish_scheduler(claim, None, True, NOW)
    assert store(["GET", key("marker")]) is None
    c.end_change(first)
    assert c.read_state()["status"]["pending_count"] == 1
    # A committed writer whose end request failed still prevents every skip.
    for tick in (NOW + 1, NOW + 1000000):
        run = c.claim_scheduler(tick)
        assert run["action"] == "run"
        c.finish_scheduler(run, None, True, tick)
        assert store(["GET", key("marker")]) is None
    c.end_change("not-owned")
    assert c.read_state()["status"]["pending_count"] == 1
    c.end_change(second)
    run = c.claim_scheduler(NOW + 1000001)
    c.finish_scheduler(run, None, True, NOW + 1000001)
    token = c.begin_change()
    assert store(["GET", key("marker")]) is None
    assert c.claim_scheduler(NOW + 1000002)["action"] == "run"
    c.end_change(token)


def test_lua_generation_fences_completed_writer_and_policy_update(live):
    c, store, key = live
    claim = c.claim_scheduler(NOW)
    token = c.begin_change()
    c.end_change(token)
    c.finish_scheduler(claim, None, True, NOW)
    assert store(["GET", key("marker")]) is None
    claim = c.claim_scheduler(NOW + 1)
    c.save_health(True, NOW, c.read_health(NOW)["generation"])
    old = c.read_state()["revision"]
    state = c.update_policy(dict(rc.DEFAULT_POLICY, idle_recheck_minutes=15), old)
    assert state["revision"] != old
    with pytest.raises(rc.ConflictError):
        c.update_policy(rc.DEFAULT_POLICY, old)
    assert c.read_health(NOW)["needs_probe"] is True
    c.finish_scheduler(claim, None, True, NOW + 1)
    assert store(["GET", key("marker")]) is None


def test_lua_ambiguous_begin_and_failed_end_leave_durable_pending(live):
    c, store, key = live
    def ambiguous(command):
        store(command)
        raise TimeoutError("synthetic lost response")
    unconfirmed = coordinator(ambiguous)
    with pytest.raises(rc.CoordinationUnavailable):
        unconfirmed.begin_change()
    assert c.read_state()["status"]["pending_count"] == 1
    assert store(["TTL", key("pending")]) == -1
    token = c.begin_change()
    def failed(_):
        raise TimeoutError("synthetic pre-send timeout")
    with pytest.raises(rc.CoordinationUnavailable):
        coordinator(failed).end_change(token)
    assert c.read_state()["status"]["pending_count"] == 2
    run = c.claim_scheduler(NOW)
    c.finish_scheduler(run, None, True, NOW)
    assert c.claim_scheduler(NOW + 1)["action"] == "run"


def test_lua_expired_or_replaced_lease_cannot_publish_or_release(live):
    c, store, key = live
    old = c.claim_scheduler(NOW)
    store(["PEXPIRE", key("lease"), 1])
    time.sleep(0.01)
    fresh = c.claim_scheduler(NOW + 181)
    assert fresh["token"] != old["token"]
    c.finish_scheduler(old, None, True, NOW + 181)
    assert store(["GET", key("lease")]) == fresh["token"]
    assert store(["GET", key("marker")]) is None
    c.finish_scheduler(fresh, None, True, NOW + 181)
    published = store(["GET", key("marker")])
    c.finish_scheduler(old, NOW + 999999, True, NOW + 182)
    assert store(["GET", key("marker")]) == published


@pytest.mark.parametrize("marker", [None, "garbage", "{}", '[]',
    '{"generation":"wrong","next_at":9999999999}',
    '{"generation":true,"next_at":"later"}'])
def test_lua_missing_or_corrupt_marker_runs(live, marker):
    c, store, key = live
    if marker is not None:
        store(["SET", key("marker"), marker])
    assert c.claim_scheduler(NOW)["action"] == "run"


def test_lua_missing_generation_resets_conservatively_without_clearing_pending(live):
    c, store, key = live
    old = c.claim_scheduler(NOW)
    token = c.begin_change()
    store(["DEL", key("generation")])
    fresh = c.claim_scheduler(NOW + 1)
    assert fresh["action"] == "run"
    assert fresh["generation"] != old["generation"]
    assert c.read_state()["status"]["pending_count"] == 1
    c.finish_scheduler(old, None, True, NOW + 1)
    assert store(["GET", key("lease")]) == fresh["token"]
    c.end_change(token)


def test_lua_failure_retry_and_actual_health_cache(live):
    c, store, key = live
    claim = c.claim_scheduler(NOW)
    assert c.read_health(NOW)["needs_probe"] is True
    c.finish_scheduler(claim, None, False, NOW)
    assert c.claim_scheduler(NOW + 59)["action"] == "skip"
    claim = c.claim_scheduler(NOW + 60)
    assert claim["action"] == "run"
    c.finish_scheduler(claim, None, True, NOW + 60)
    assert c.read_health(NOW + 60)["ok"] is False
    c.save_health(True, NOW + 60, c.read_health(NOW + 60)["generation"])
    assert c.read_health(NOW + 61) == {"cached": True, "ok": True, "needs_probe": False}
    assert c.read_health(NOW + 60 + 3600)["needs_probe"] is True
    c.save_health(False, NOW + 3660, c.read_health(NOW + 3660)["generation"])
    assert c.read_health(NOW + 3719) == {"cached": True, "ok": False, "needs_probe": False}
    assert c.read_health(NOW + 3720)["needs_probe"] is True


def test_lua_cron_veto_and_recovery(live):
    c, store, key = live
    c._environ["SCHEDULE_RUNNER_SECRET"] = "synthetic-cron-secret"
    c.save_health(True, NOW, c.read_health(NOW)["generation"])
    assert c.read_health(NOW)["ok"] is False
    run = c.claim_scheduler(NOW)
    c.finish_scheduler(run, None, True, NOW)
    assert c.read_health(NOW + 300)["ok"] is True
    assert c.read_health(NOW + 301)["ok"] is False
    store(["DEL", key("marker")])
    run = c.claim_scheduler(NOW + 302)
    c.finish_scheduler(run, None, False, NOW + 302)
    token = c.begin_change()
    c.end_change(token)
    c.save_health(True, NOW + 302, c.read_health(NOW + 302)["generation"])
    assert c.read_health(NOW + 303)["ok"] is False
    run = c.claim_scheduler(NOW + 362)
    c.finish_scheduler(run, None, True, NOW + 362)
    assert c.read_health(NOW + 363)["ok"] is True


def simultaneous(*operations):
    gate = Barrier(len(operations))
    def run(operation):
        gate.wait(timeout=10)
        return operation()
    with ThreadPoolExecutor(max_workers=len(operations)) as pool:
        futures = [pool.submit(run, operation) for operation in operations]
        return [future.result(timeout=15) for future in futures]


def test_lua_simultaneous_scheduler_claims_have_one_owner(live):
    c, store, key = live
    workers = [coordinator(store) for _ in range(8)]
    results = simultaneous(*(lambda worker=worker: worker.claim_scheduler(NOW)
                             for worker in workers))
    owners = [result for result in results if result["action"] == "run"]
    assert len(owners) == 1
    assert sum(result["action"] == "busy" for result in results) == 7
    assert store(["GET", key("lease")]) == owners[0]["token"]
    assert c.read_state()["status"]["runs"] == 1


def test_lua_simultaneous_policy_cas_has_one_winner(live):
    c, store, key = live
    revision = c.read_state()["revision"]
    generation = int(store(["GET", key("generation")]))
    def update(value):
        try:
            return coordinator(store).update_policy(
                dict(rc.DEFAULT_POLICY, client_poll_seconds=value), revision)
        except rc.ConflictError:
            return "conflict"
    results = simultaneous(*(lambda value=value: update(value) for value in range(60, 68)))
    winners = [result for result in results if isinstance(result, dict)]
    assert len(winners) == 1
    assert results.count("conflict") == 7
    assert c.read_state()["policy"] == winners[0]["policy"]
    assert int(store(["GET", key("generation")])) == generation + 1


@pytest.mark.parametrize("iteration", range(12))
def test_lua_simultaneous_begin_and_finish_cannot_leave_skip_marker(live, iteration):
    c, store, key = live
    claim = c.claim_scheduler(NOW + iteration)
    writer = coordinator(store)
    token, _ = simultaneous(
        writer.begin_change,
        lambda: c.finish_scheduler(claim, None, True, NOW + iteration))
    assert store(["SISMEMBER", key("pending"), token]) == 1
    assert store(["TTL", key("pending")]) == -1
    assert store(["GET", key("marker")]) is None
    assert c.read_state()["status"]["pending_count"] == 1
    next_claim = c.claim_scheduler(NOW + iteration + 1)
    assert next_claim["action"] == "run"
    writer.end_change(token)
    # Completing the writer changes generation again, fencing this in-flight run.
    c.finish_scheduler(next_claim, None, True, NOW + iteration + 1)
    assert store(["GET", key("marker")]) is None


def test_lua_simultaneous_writers_and_duplicate_ends_preserve_other_tokens(live):
    c, store, key = live
    tokens = simultaneous(*(coordinator(store).begin_change for _ in range(8)))
    assert len(set(tokens)) == 8
    assert c.read_state()["status"]["pending_count"] == 8
    generation = int(store(["GET", key("generation")]))
    simultaneous(*(lambda token=token: coordinator(store).end_change(token)
                   for token in tokens[:4] for _ in range(2)))
    assert set(store(["SMEMBERS", key("pending")])) == set(tokens[4:])
    assert int(store(["GET", key("generation")])) == generation + 8
    assert store(["TTL", key("pending")]) == -1
    run = c.claim_scheduler(NOW)
    c.finish_scheduler(run, None, True, NOW)
    assert store(["GET", key("marker")]) is None


def test_health_generation_response_is_internal_and_allowlisted():
    response = {"cached": False, "ok": False, "needs_probe": True,
                "generation": "opaque-probe-generation", "external_id": "hidden"}
    result = coordinator(lambda _: json.dumps(response)).read_health(NOW)
    assert result == {key: response[key] for key in ("cached", "ok", "needs_probe", "generation")}
    response.update(cached=True, ok=True, needs_probe=False)
    assert "generation" not in coordinator(lambda _: json.dumps(response)).read_health(NOW)


@pytest.mark.parametrize("generation", ["", False, 1, [], {}])
def test_invalid_probe_generation_never_reaches_transport(generation):
    c = coordinator(lambda _: pytest.fail("invalid generation reached transport"))
    with pytest.raises(ValueError):
        c.save_health(True, NOW, generation)


@pytest.mark.parametrize("ok", [True, False])
def test_lua_health_without_probe_generation_does_not_cache(live, ok):
    c, store, key = live
    c.save_health(ok, NOW)
    assert store(["GET", key("health")]) is None
    probe = c.read_health(NOW)
    assert probe["needs_probe"] is True
    assert isinstance(probe["generation"], str) and probe["generation"]
    c.save_health(ok, NOW, probe["generation"])
    assert c.read_health(NOW) == {"cached": True, "ok": ok, "needs_probe": False}
    original = store(["GET", key("health")])
    c.save_health(not ok, NOW + 1)
    assert store(["GET", key("health")]) == original
    assert "generation" not in json.dumps(c.read_state())


@pytest.mark.parametrize("invalidation", ["policy", "completed_writer", "generation_reset"])
@pytest.mark.parametrize("ok", [True, False])
def test_lua_health_probe_result_rejected_after_invalidation(live, invalidation, ok):
    c, store, key = live
    probe = c.read_health(NOW)
    if invalidation == "policy":
        c.update_policy(dict(rc.DEFAULT_POLICY, database_probe_minutes=15), c.read_state()["revision"])
    elif invalidation == "completed_writer":
        c.end_change(c.begin_change())
    else:
        store(["DEL", key("generation")])
    c.save_health(ok, NOW + 1, probe["generation"])
    assert store(["GET", key("health")]) is None
    fresh = c.read_health(NOW + 1)
    assert fresh["needs_probe"] is True
    assert fresh["generation"] != probe["generation"]
    c.save_health(not ok, NOW + 2, fresh["generation"])
    replacement = store(["GET", key("health")])
    c.save_health(ok, NOW + 3, probe["generation"])
    assert store(["GET", key("health")]) == replacement


@pytest.mark.parametrize("ok", [True, False])
def test_lua_backup_cleanup_failure_during_probe_keeps_health_uncached(live, ok):
    c, store, key = live
    probe = c.read_health(NOW)
    # A backup/mutation begins during the DB probe, then its post-operation
    # invalidation cannot reach Redis. Its persistent pending token must survive.
    token = c.begin_change()
    def unavailable(_):
        raise TimeoutError("synthetic backup cleanup failure")
    with pytest.raises(rc.CoordinationUnavailable):
        coordinator(unavailable).end_change(token)
    c.save_health(ok, NOW + 1, probe["generation"])
    assert store(["GET", key("health")]) is None
    assert store(["SISMEMBER", key("pending"), token]) == 1
    assert store(["TTL", key("pending")]) == -1
    # Even a new probe with the current generation cannot cache while pending.
    current = c.read_health(NOW + 2)
    c.save_health(ok, NOW + 3, current["generation"])
    assert store(["GET", key("health")]) is None
    c.end_change(token)
    c.save_health(ok, NOW + 4, current["generation"])
    assert store(["GET", key("health")]) is None
    fresh = c.read_health(NOW + 5)
    c.save_health(ok, NOW + 6, fresh["generation"])
    assert c.read_health(NOW + 7)["cached"] is True


@pytest.mark.parametrize("invalidation", ["begin", "policy"])
@pytest.mark.parametrize("iteration", range(6))
def test_lua_simultaneous_health_save_and_invalidation_cannot_leave_cache(live, invalidation, iteration):
    c, store, key = live
    probe = c.read_health(NOW)
    worker = coordinator(store)
    if invalidation == "begin":
        change = worker.begin_change
    else:
        revision = c.read_state()["revision"]
        change = lambda: worker.update_policy(rc.DEFAULT_POLICY, revision)
    simultaneous(lambda: c.save_health(True, NOW + iteration, probe["generation"]), change)
    assert store(["GET", key("health")]) is None
    assert c.read_health(NOW + iteration + 1)["needs_probe"] is True


def test_lua_new_store_drains_before_idle_skips(store):
    c = coordinator(store)
    prefix = c._configuration()[2]
    first = c.claim_scheduler(NOW)
    c.finish_scheduler(first, None, True, NOW)
    assert store(['GET', prefix + 'marker']) is None
    for offset in (1, 299, 599):
        claim = c.claim_scheduler(NOW + offset)
        assert claim['action'] == 'run'
        c.finish_scheduler(claim, None, True, NOW + offset)
        assert store(['GET', prefix + 'marker']) is None
    claim = c.claim_scheduler(NOW + 600)
    assert claim['action'] == 'run'
    c.finish_scheduler(claim, None, True, NOW + 600)
    assert c.claim_scheduler(NOW + 601)['action'] == 'skip'


def test_lua_reset_during_writer_drains_and_retains_other_pending_tokens(live):
    c, store, key = live
    token = c.begin_change()
    store(['DEL', key('epoch'), key('generation')])
    claim = c.claim_scheduler(NOW)
    assert claim['action'] == 'run'
    c.finish_scheduler(claim, None, True, NOW)
    assert store(['SISMEMBER', key('pending'), token]) == 1
    c.end_change(token)
    claim = c.claim_scheduler(NOW + 599)
    c.finish_scheduler(claim, None, True, NOW + 599)
    assert store(['GET', key('marker')]) is None
    claim = c.claim_scheduler(NOW + 600)
    c.finish_scheduler(claim, None, True, NOW + 600)
    assert c.claim_scheduler(NOW + 601)['action'] == 'skip'


def test_lua_late_success_cannot_overwrite_newer_failed_health(live):
    c, store, key = live
    probe = c.read_health(NOW)
    c.save_health(False, NOW + 5, probe['generation'])
    failed = store(['GET', key('health')])
    c.save_health(True, NOW, probe['generation'])
    assert store(['GET', key('health')]) == failed
    assert c.read_health(NOW + 6)['ok'] is False


def test_lua_partial_pending_loss_restarts_drain_and_unknown_end_invalidates(live):
    c, store, key = live
    token = c.begin_change()
    store(['DEL', key('pending')])
    claim = c.claim_scheduler(NOW)
    assert claim['action'] == 'run'
    c.finish_scheduler(claim, None, True, NOW)
    assert store(['GET', key('marker')]) is None
    before = store(['GET', key('generation')])
    c.end_change(token)
    assert store(['GET', key('generation')]) != before
    claim = c.claim_scheduler(NOW + 599)
    c.finish_scheduler(claim, None, True, NOW + 599)
    assert store(['GET', key('marker')]) is None
    claim = c.claim_scheduler(NOW + 600)
    c.finish_scheduler(claim, None, True, NOW + 600)
    assert c.claim_scheduler(NOW + 601)['action'] == 'skip'


@pytest.mark.parametrize('changed', [
    {'BACKUP_S3_BUCKET': 'private-synthetic'},
    {'BACKUP_ENCRYPTION_KEY': 'synthetic-key'},
    {'SCHEDULE_RUNNER_SECRET': 'synthetic-runner'},
    {'VERCEL_DEPLOYMENT_ID': 'synthetic-next-deployment'},
    {'FLOWBUDGET_DATABASE_URL': 'postgresql://fake:changed@db.example.test/budget'},
])
def test_health_configuration_changes_do_not_inherit_readiness_or_reset_scheduler(store, changed):
    c = coordinator(store)
    probe = c.read_health(NOW)
    c.save_health(True, NOW, probe['generation'])
    assert c.read_health(NOW)['cached'] is True
    other = coordinator(store, **changed)
    assert other._configuration()[2] == c._configuration()[2]
    assert other.read_health(NOW)['needs_probe'] is True
    assert c.read_health(NOW)['cached'] is True
