# Reliability operations

## Release gates

Budgetly's release script checks version consistency, frontend tests and build,
and Android JVM tests before publishing. Run backend tests before release too:
`python -m pytest tests -q` with requirements-dev.txt installed. GitHub quality gates
repeat web/API and unsigned Android checks on pushes and pull requests.
Never bypass a failing gate to publish an APK.

## Health and incident handling

`/api/health/ready` returns only an `ok` boolean and HTTP 200 or 503. It checks
database availability, configured scheduling heartbeats, and overdue entries.
Unconfigured background services are not represented as working services.
Admin service health shows heartbeat times and overdue counts without secrets.

The GitHub service-health workflow checks readiness roughly every 15 minutes.
GitHub may delay scheduled runs and disables inactive public-repository schedules
after 60 days. It is a useful independent check, not a guaranteed paging service.
An unhealthy service opens one bot-owned repository issue assigned to the owner;
recovery comments on and closes that issue. Enable GitHub email notifications
for assigned issues. A failed workflow is also visible in Actions.

On an incident, inspect Vercel function logs using the request ID, confirm the
database connection and scheduler job history, and correct the failed service.
Do not copy environment secrets or financial payloads into issues. Re-run the
health workflow after recovery. Prefer rollback of a faulty deployment over
changing or deleting customer records.

## Error reporting

Signed-in clients send rate-limited error category, app version, and an allowlisted
page only. Reports exclude message text, stacks, query parameters, financial
records, and tokens. Server logs use route templates, exception types and request
IDs, not request bodies. The crash screen allows reloading without clearing data.
These reports support triage; they are not a full tracing or session-replay system.

## Recovery and release evidence

Use the isolated synthetic recovery/load tool described in
`LOCAL_SECURITY_RECOVERY_REVIEW.md`. Keep plaintext backup exports in a protected
directory, not the repository. Verify restoration in an isolated database before
touching live records. Maintain external backup retention separately.

Android JVM tests cannot prove Firebase delivery, bank-app notification content,
installer behavior, OEM battery policies, or biometric hardware. Run those checks
on a real device after installing each native-behavior update. Local SQLite load
results do not certify production PostgreSQL capacity.

## Readiness freshness and monitoring limits

With resource coordination enabled, public readiness can return a cached result
without opening a database connection. A successful result means the last real
probe passed within `database_probe_minutes` (15–1440 minutes), not that the
DB is reachable at this instant. The authenticated scheduler heartbeat can veto
cached success. Backup freshness and overdue-entry queries run on real probes;
a backup can cross its 36-hour freshness deadline before cached success expires.
Changing those cache semantics requires coordination/runtime work outside the
monitoring module. Do not increase probe frequency or add a database query to
every monitor request merely to bypass this deliberate Neon wakeup reduction.

On real probes, configured scheduler heartbeats must be within five minutes;
daily recovery and external backup successes must be within 36 hours. Future
timestamps are unhealthy. For equal timestamps, the highest event ID wins, so a
later failure cannot be hidden by an earlier success. Partial external backup
configuration is unhealthy. These signals attest to recorded job completion;
they do not verify object retention, decryptability, or restore integrity.

The production monitor requests no intermediary cache, but this does not bypass
the application's coordination cache. It retries transport/protocol failures and
unhealthy responses up to three times, with five seconds between attempts. It
reports only readiness and does not expose response bodies or exception text.
Its issue recovery action therefore reflects public readiness, including the
cache limits above, rather than independent proof of live database availability.

### Public readiness source headers

GET `/api/health/ready` responses include `Cache-Control: no-store` and
`X-Budgetly-Readiness-Source: cached` when coordination serves the response
without dispatching the application. Both healthy and unhealthy cached results
use this label. Responses dispatched through the application use `probe`,
including when coordination is disabled or unavailable and when initialization
or database access fails. `probe` identifies the uncached path; it does not claim
that initialization completed or a database connection succeeded. Status and the
existing response body remain authoritative; the readiness handler still returns
only `{"ok": true}` or `{"ok": false}`. Existing initialization/error response
bodies remain unchanged.

The source header exposes no generation, credential, or probe timestamp.
`no-store` prevents HTTP caching; it does not bypass the coordination cache.
Administrators bound successful cache lifetime with `database_probe_minutes`
(15–1440 minutes) through the authenticated resource policy. Negative cache
results expire after 60 seconds. A cached success may therefore precede a current
outage; these headers disclose that distinction without adding database queries
or Neon wakeups. There is no public force-probe switch.
