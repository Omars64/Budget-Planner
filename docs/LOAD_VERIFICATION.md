# Isolated PostgreSQL Load Verification

## Release regression gate

The quality workflow now runs the existing 32-worker, 30-second workload on a
fresh PostgreSQL 17 service for each pull request and main-branch push. It uses
20 synthetic accounts and 20,060 initial entries, with concurrent dashboard,
transaction and analytics reads, creates and idempotent replays. The job fails
on any request error or final ledger/receipt reconciliation failure and retains
aggregate evidence as the `postgres-load-evidence` Actions artifact, including
on failure. It has no production credentials or application deployment target.

Latency and throughput remain observations rather than fixed acceptance limits:
shared CI hardware varies. This gate detects correctness and availability
regressions in this bounded workload; it does not establish production capacity.
The Android release launcher waits for the complete quality workflow, including
this job, before publishing an APK.

Run from the repository root using the project's Python environment, in a fresh
process. This harness refuses application API URLs, remote or ambiguous database
hosts, connection query overrides, other databases, and ports other than 55432.
The only accepted database is `budgetly_verification_load` on numeric loopback.
Create that dedicated disposable database locally before running. Never supply
production URLs or copy live records into it.

Use `python` below with `requirements-dev.txt` installed. The recorded runs used
the existing system Python because this checkout's `.venv` lacked pytest.

```powershell
python -m scripts.verify_load --url postgresql://postgres@127.0.0.1:55432/budgetly_verification_load --workers 16
python -m scripts.verify_load --url postgresql://postgres@127.0.0.1:55432/budgetly_verification_load --workers 32
```

The default measured duration is 30 seconds; `--duration` accepts 1..300 finite
seconds. `--records` accepts 1,000..10,000 history records per account. Normal
runs always use 20 accounts and 16 or 32 workers. `--smoke` instead fixes two
accounts, 20 history records, two workers and defaults to two seconds (1..5
allowed). Smoke is an integration check, not performance evidence.

```powershell
python -m pytest tests/test_load_verification.py tests/test_postgres_verification.py -q
$env:BUDGETLY_LOAD_SMOKE_URL = 'postgresql://postgres@127.0.0.1:55432/budgetly_verification_load'
python -m pytest tests/test_load_verification.py -q
```

## Isolation

The runner directly reuses `verify_postgres.validate_url`, `isolated_environment`,
`network_guard`, and `owned_schema`. It clears inherited database aliases,
credentials, integrations and libpq routing settings before importing the API.
It creates a random schema, verifies the search path, and drops only that schema
after verifying its recorded OID, including on failures. It disposes connections
before cleanup. It does not create or drop databases or change API source files.
The harness is intended for disposable local PostgreSQL, not a local proxy or
tunnel to a remote database.

Requests use in-process FastAPI TestClient without lifespan, so startup migrations,
demo seeding and background services do not run. A request header selects only
one of the freshly created synthetic identities through an authentication
dependency override; each request gets its own SQLAlchemy session. Actual personal
workspace dependencies and routes still execute. Authentication, login limits,
HTTP transport, deployment infrastructure and background jobs are outside this
measurement. The inherited guard restricts Python sockets; psycopg's libpq
connection is constrained by the validated URL and scrubbed environment.

## Workload And Correctness

Each account has three wallets, six categories, three opening entries, and the
requested additional history records spread over six calendar months. History
uses exact three-decimal amounts and includes expenses, income and transfers.
Fixtures are inserted through SQLAlchemy to keep setup outside measured traffic.

After warmup of all read routes for every account, concurrent workers submit
the same idempotency key and must receive identical responses. Measured workers
then repeat a deterministic ten-request cycle: three dashboard reads, three
filtered transaction lists (limit 50), two six-month analytics reads, one expense
creation and one replay of that creation. The account rotates each cycle. Clients
and sessions are independent; a barrier starts the measured workers together.
Workers stop starting requests at the deadline and drain in-flight requests.
Slow requests can therefore extend elapsed time beyond the requested duration.
Finite runs can have a slightly different actual route mix from the cycle ratio.

Every response is checked for expected status, shape and account wallet/category
isolation. Failed requests remain in latency/error statistics and workers continue.
Final checks require exact per-account ledger counts, distinct transaction IDs
for distinct keys, one stored request receipt per attempted unique key, stable
receipt-to-transaction links, and three opening entries per account. Decimal
balances include both sides of transfers and each unique load expense exactly
once. Quiescent dashboard wallet balances and totals, dashboard monthly totals,
and analytics monthly income/expense are compared with persisted ledger amounts.
A nonzero error rate or any failed correctness check makes the run fail.
Here "receipts" means idempotency request receipts; image attachments are not
part of this workload.

## Evidence And Interpretation

Stdout is aggregate JSON only. Optional `--output PATH` exclusively creates a new
aggregate JSON file and refuses an existing file. Reports contain counts, route
labels, numeric status distributions, p50/p95 milliseconds (nearest rank), error
rates, request throughput, workload parameters, PostgreSQL/Python versions and
basic hardware context. They contain no connection URL, credentials, identities,
ledger rows, payloads or raw exception messages. Latencies include request
serialization, ASGI handling, database work and response validation, including
failed requests. Throughput divides completed requests by measured elapsed time
including drain; setup, warmup and final correctness checks are excluded.
Application logging and runtime warnings are suppressed during the isolated run
so individual request diagnostics cannot contaminate the aggregate evidence.

This is a closed-loop workload with 16 or 32 concurrent request initiators, not
16 or 32 guaranteed simultaneous database queries. It uses the application's
existing database pool configuration. Repeat runs on documented hardware with
no competing PostgreSQL tests to assess variation. No latency acceptance threshold
or claim about enterprise capacity is implied. This local workload cannot establish
production capacity, remote network latency, multi-instance behavior or a maximum
sustainable arrival rate.

## Recorded Local Results

Executed on 2026-10-12 against disposable local PostgreSQL 17.11, with no concurrent
PostgreSQL verification tests. Hardware: Windows AMD64, Intel Core i7-1355U,
10 physical cores / 12 logical processors, 25,439,191,040 bytes installed RAM
(23.69 GiB), Python 3.13.15. Both final runs use the default 20 accounts,
1,000 history records plus three opening records per account (20,060 initial
ledger records), three wallets, six categories and six months of history.
The server was supplied by the parent reliability task; this harness neither
started nor stopped it. These are sequential single samples on a development
machine, without controlled CPU frequency or background OS activity.

| Workers | Requested / Elapsed Seconds | Requests | Requests/s | p50 ms | p95 ms | Errors | Correctness |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 16 | 30 / 30.452 | 687 | 22.560 | 577.131 | 1334.116 | 0 (0%) | Passed |
| 32 | 30 / 31.642 | 768 | 24.272 | 1172.451 | 2064.348 | 0 (0%) | Passed |

Per-route measured results (milliseconds):

| Workers | Route | Requests | p50 ms | p95 ms | Requests/s | Errors |
| --- | --- | --- | --- | --- | --- | --- |
| 16 | Dashboard | 211 | 1114.687 | 1579.139 | 6.929 | 0 |
| 16 | Filtered list | 211 | 461.051 | 672.507 | 6.929 | 0 |
| 16 | Analytics | 138 | 583.865 | 828.074 | 4.532 | 0 |
| 16 | Create | 64 | 472.119 | 999.416 | 2.102 | 0 |
| 16 | Replay | 63 | 344.095 | 801.467 | 2.069 | 0 |
| 32 | Dashboard | 243 | 1609.001 | 3296.090 | 7.680 | 0 |
| 32 | Filtered list | 242 | 989.472 | 1739.750 | 7.648 | 0 |
| 32 | Analytics | 157 | 1141.734 | 1809.117 | 4.962 | 0 |
| 32 | Create | 63 | 1036.213 | 2032.125 | 1.991 | 0 |
| 32 | Replay | 63 | 847.333 | 1516.146 | 1.991 | 0 |

The final 16-worker run reconciled 65 unique writes including one contended
preflight key. One create finished near the deadline without a measured replay;
its persisted receipt and balance effect were still checked. A preliminary
16-worker run with request diagnostics enabled completed 409 requests at
13.252 requests/s and p95 2703.808 ms, also without errors or correctness
failures. That variation reinforces the limits of extrapolating these samples.
The 32-worker run reconciled 64 unique writes including preflight. Its observed
throughput was about 7.6% higher and overall p95 about 55% higher than the earlier
16-worker sample; dashboard p95 was 3296.090 ms. CPU frequency and background
CPU load were not controlled, so these comparisons do not establish that worker
count caused the differences or identify a production bottleneck.

Validation: 81 focused tests passed, including the explicitly enabled local
PostgreSQL smoke and the existing PostgreSQL verifier's safety tests.
After both final runs, the dedicated database's schema catalog contained zero
`budgetly_verification_*` schemas. PostgreSQL was left running for the parent
task; all load workers and verification subprocesses have completed.

### Final Post-Coordination Evidence

After the coordination fix, the parent task reran the realistic 16-worker,
30-second workload. The aggregate evidence is saved in
[load-623-coordination-final.json](../.verification/load-623-coordination-final.json).
It reports 20 synthetic accounts, 1,000 history records plus three opening
entries per account, PostgreSQL 17.11 and the same Windows/Python hardware context.

| Workers | Requested / Elapsed Seconds | Requests | Requests/s | p50 ms | p95 ms | Errors | Correctness |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 16 | 30 / 30.474 | 555 | 18.212 | 708.594 | 1690.742 | 0 (0%) | Passed |

The run reconciled 49 unique writes including the contended preflight key;
balances and receipt counts passed their correctness checks. This is the final
post-coordination 16-worker sample. CPU frequency and background CPU load can vary between
local runs and were not controlled here. Differences from the earlier samples
cannot be causally attributed to the coordination fix, worker count or any one
CPU effect; no production-capacity conclusion follows from these comparisons.

### Failed Post-Coordination 32-Worker Run

The parent's subsequent 32-worker run failed; at that point it superseded the
earlier passing 32-worker sample. It remains recorded here for transparency;
the final run after the fixes is appended below. See
[load-623-coordination-32-final.json](../.verification/load-623-coordination-32-final.json).

| Workers | Requested / Elapsed Seconds | Requests | Requests/s | p50 ms | p95 ms | Errors | Correctness |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 32 | 30 / 52.100 | 447 | 8.580 | 1397.198 | 31090.514 | 10 (2.237%) | Passed |

Error statuses were five 409, four 500 and one 503. Analytics had five errors,
dashboard two, filtered list two, replay one and creation zero. All 33 unique
writes including preflight reconciled; passing ledger correctness does not make
this availability failure a passing load run.

### Read-Only Failure Diagnosis

This section records the historical code paths investigated before the fixes
described in the final evidence below. Inspection of that code and the installed framework establishes
a concrete starvation mechanism, reproduced without PostgreSQL in an in-memory
FastAPI/SQLAlchemy test:

1. At initial inspection, `materialize_recurring_for_user` acquired an owner claim before checking for
   recurring templates. Dashboard, list and analytics call it, even though the
   synthetic fixture contains no recurring templates. `lock_owners` compiles its
   PostgreSQL claim select to `FOR NO KEY UPDATE` and performs a no-op update;
   these are exclusive owner locks. When no records are created, materialization
   did not commit. Locks and the connection remained in the request transaction.
   During diagnosis, Rawls changed this helper to return when no due recurrence
   exists before acquiring the owner claim. The unconditional read-lock path
   described here is therefore historical; that change has not been load-tested
   by this diagnosis.
2. Request-scoped yielded database dependencies close after response transmission
   in the installed FastAPI. `storage_readiness` middleware runs after `call_next`
   has obtained response headers but before sending the response body. It persists
   a `ServiceEvent` through a separate `SessionLocal` whenever a request takes at
   least two seconds or returns a 5xx. Suppressing logging does not suppress this
   database write. A request therefore can need a second pooled connection while
   still holding its first connection and owner lock.
3. The isolated runner clears `VERCEL` and uses the application's default
   SQLAlchemy QueuePool: five persistent connections, ten overflow connections,
   30-second checkout timeout. At 32 workers, slow requests can fill all 15
   connections while their middleware waits for second checkouts. Other requests
   cannot acquire a first connection, and the pool may make progress only after
   checkout or PostgreSQL lock timeouts release a holder. This is connection
   starvation involving application middleware, not proof of a PostgreSQL deadlock.
4. PostgreSQL `55P03` (including the runner's 10-second lock timeout) is converted
   by `lock_owners` to 409. A SQLAlchemy pool `TimeoutError` is not an
   `OperationalError` and follows a 500 error path. PostgreSQL operational errors
   can follow a 503 path. The historical status counts and approximately 31-second
   tail fit these mechanisms, but the precise exception behind each historical
   failure was not captured and cannot be recovered from this aggregate report.

`snapshot_session` also borrows a second connection for standalone exports when
no owner claim is held. The load schedule does not call exports or recovery;
that path is an additional pool-pressure risk, not an explanation for this run.
The middleware path above applies to the actual measured read routes. This
diagnosis does not attribute the observed regression to CPU variation or prove
that every failed request had the same cause.

The API owner should address diagnostic persistence that borrows another pooled
connection while request transactions remain open. Rawls's in-progress recurrence
change addresses unconditional owner claims on reads with no due work. Increasing the pool alone does
not remove the second-checkout dependency or owner serialization. API changes
remain with Rawls; this harness does not change pool limits, API behavior or locks.

### Opt-In Sanitized Error Diagnostics

Future authorized runs can add `--diagnose-errors`. It adds `error_diagnostics`
containing the active pool class/limits and fixed-category observation counts,
separated into setup, measured traffic (including drain), and final verification.
It observes pool checkout `TimeoutError`, SQLAlchemy database error events with
allowlisted PostgreSQL SQLSTATE categories (lock unavailable, deadlock, query
cancelled, serialization failure, connection failure/limit, unique conflict), and allowlisted 409
response categories. Unknown details become fixed generic categories. No SQL,
exception messages, connection URLs, request IDs or response payloads are retained
or emitted. Raw logging stays disabled. Hooks are removed after the run.

These are observation counts, not distinct failed-request counts: a lock failure
can contribute both a database observation and a conflict-response observation;
middleware event failures can contribute internal errors even for a 200 response.
SQLSTATE `23505` is classified separately as `expected_unique_conflict`. The
idempotency receipt reservation deliberately catches a duplicate-key
`IntegrityError` and returns the previously saved response for a valid replay;
the database error hook observes this handled exception before recovery. Such
an observation does not mean that the request failed. The category names the
expected replay path; another unique constraint violation can emit the same
SQLSTATE, so request status and correctness checks remain authoritative.
`postgres_query_cancelled` does not alone distinguish a statement timeout from
another cancellation. Codes cannot retroactively diagnose the existing report.

No PostgreSQL connections or load reruns were made during this diagnosis while
Rawls was using PostgreSQL. The instrumentation was verified only offline:
57 harness tests passed; the PostgreSQL smoke was explicitly deselected. The
parent's subsequent integration evidence is recorded below.

### Final 32-Worker Evidence After Fixes

The parent reran the realistic 32-worker, 30-second workload after Rawls's due
recurrence probe removed unnecessary read owner claims and the parent moved
service-event persistence to `api/service_events.py`. The latter uses an
independent `NullPool` engine, two-second PostgreSQL connection timeout, and
250 ms statement and lock timeouts, called through an asynchronous threadpool
dispatch. Financial request pooling remains QueuePool (5 + 10 overflow);
diagnostic writes no longer borrow connections from that pool. See
[load-623-poolfix-32.json](../.verification/load-623-poolfix-32.json).

| Workers | Requested / Elapsed Seconds | Requests | Requests/s | p50 ms | p95 ms | Errors | Correctness |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 32 | 30 / 30.891 | 807 | 26.124 | 1109.027 | 2047.846 | 0 (0%) | Passed |

The run used 20 synthetic accounts with 1,000 history records plus three opening
entries each and reconciled 65 unique writes including preflight. It measured
64 creates and 64 replays, all returning 201. All routes and final balance and
receipt checks passed. This is the final passing 32-worker sample; the prior
failed run above is retained without changing its evidence.

The saved report predates the `23505` classification and records 64 measured
`other_database_error` observations, exactly matching the 64 successful replays,
plus 31 setup observations matching the 31 losing reservations in the 32-worker
same-key preflight. That correspondence is consistent with handled duplicate
receipt insertions, not failed requests. Because that report did not retain
SQLSTATE, this is an inference rather than a retroactive relabeling of its data.
Future runs classify `23505` as `expected_unique_conflict` separately. These
hooks observe the financial engine; they do not observe the new independent
service-event engine's database errors.

The code changes remove the identified shared-pool checkout dependency and
unnecessary read-lock path. CPU frequency and background activity were not
controlled between these local samples, so timing comparisons alone do not
quantify either fix's causal contribution or establish production capacity.
