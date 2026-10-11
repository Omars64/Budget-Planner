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
