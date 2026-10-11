# Focused Security Implementation Review

Review date: 2026-10-11. Source review, synthetic databases, mocked providers.
No secrets/live records, external provider calls, deployment, or version changes.

## Fixed Risks

- Pending Google sign-in previously minted a session after reset/global signout.
  Those actions now invalidate identified pending flows; ready Google callbacks
  record a credential digest and completion rejects changed credentials.
- Rate limits used read/modify/write counters with FOR UPDATE, ineffective on
  SQLite. Database expressions now increment/reset buckets atomically.
- Reset tokens relied on row locks. Conditional deletion now claims an unexpired
  token before updating credentials in the same transaction.
- Confirmation requires a live, owned, unrevoked session younger than one day;
  bearer validation also checks the stored session lifetime.
- Drive disconnect formerly discarded the only refresh token before remote
  revocation. It now commits encrypted retry work and clears usable credentials
  in one transaction. Failed revocations retain ciphertext for durable retry.
- Drive consent previously survived initiating-session revocation/reset. Attempts
  now bind session ID, credential digest, and connection generation. Callbacks
  validate before exchange and again during the installation transaction.

## Durable Drive Revocation

`ProviderRevocationJob` is a standalone Drive outbox, intentionally without a user
foreign key. Account deletion cannot cascade it away. Tokens stay encrypted using
the existing stable GOOGLE_DRIVE_ENCRYPTION_KEY; no ciphertext/plaintext/provider
body enters responses or logs. A missing/wrong key retains the encrypted token
with a sanitized credential_unreadable category so restoring the key permits retry.
Do not rotate that key without re-encrypting existing connection and queue tokens.

Disconnect locks/advances the connection generation, enqueues its ciphertext,
clears the connection token, cancels pending consent, and commits before I/O.
Concurrent disconnects serialize on the connection so its credential is queued
once. The immediate provider attempt remains enabled. A failed immediate attempt
returns 502/503 with a generic queued-for-retry explanation; status remains locally
disconnected and reports pending work. Explicit Retry via disconnect bypasses
backoff but respects active leases. A repeat request reports pending rather than
false completion when another worker holds the lease.

Daily maintenance dispatches at most ten due jobs before snapshots/push work.
Conditional UPDATE claims use random leases expiring after two minutes and work
on SQLite/PostgreSQL. I/O happens after the claim commit; completion is conditional
on the matching lease so a stale worker cannot erase another worker's token.
Failures release leases, increment attempts, and use exponential backoff with
jitter capped at about one day. Jobs remain recoverable without a retry-count
cutoff. Success erases ciphertext and marks completion. Worker batches have a
40-second I/O scheduling budget, at most four-second per-operation HTTP timeouts,
and a 4096-byte raw error-response bound. A final blocking operation may exceed
the scheduling deadline by its timeout; database overhead is additional. This is
bounded retry I/O, not a hard deadline for all daily maintenance/snapshots/push.

Success and HTTP 400 with exactly invalid_token complete a job; other errors retry.
The parent verified Google's [OpenID Connect revocation reference](https://developers.google.com/identity/openid-connect/reference),
which documents invalid_token for expired/already-revoked tokens. No provider call
was made to verify this behavior in this task.

Reconnect is conservatively blocked for the affected account while any Drive job
is pending or a live exchange is processing/cancelling. The checkout has one Drive
OAuth client configuration and does not model Google project boundaries; pending
jobs therefore block that account across configuration changes, rather than
assuming separate clients have separate revocation scope. Other accounts are not
blocked. Completed jobs do not prevent explicit new consent.

## Consent Serialization

Callback uses actual no-op UPDATE claims on User then AccountSession, holding
write locks until installation/cancellation commits. It checks account activity,
credential digest, session ownership/revocation/age, expiry, and connection
generation. A subsequent connection write claim and conditional attempt update
install the grant within that same transaction. SQLite obtains write serialization;
PostgreSQL obtains row locks. Reads before these write claims are insufficient.

Reset flushes changed credentials before updating sessions, matching callback's
user-then-session lock order even with autoflush disabled. Signout/revocation
flushes session revocation before cancelling consent. Disconnect/cancel serializes
on connection before changing attempts. A callback that commits first represents
completed consent; subsequent ordinary signout/reset leaves an already-connected
grant intact. A revocation that commits first prevents old consent installation.

Single revoke/signout cancels attempts for that session; global signout/reset
cancels pending attempts for the account. In-flight cancellations use cancelling
until the callback finishes. Tokens returned after cancellation, deletion,
expiry, changed credentials/generation, or rejected scopes are encrypted into
revocation work instead of discarded or installed. Poll exposes cancelling as
cancelled. An accepted connection advances generation so older consent cannot
overwrite it. Account deletion retains its existing fail-closed revocation path;
already queued work survives independently of that path.

## Migration and UI Contract

New head `f43c912ab706` follows `e92a671bf304`, adds the queue and Drive binding/
generation columns, preserves existing connected grants, and cancels legacy
pending attempts without a trustworthy session binding. PostgreSQL uses additive
ALTER TABLE; SQLite uses additive columns. Downgrade refuses pending jobs so it
cannot discard recoverable credentials. Legacy pre-Alembic startup verification
permits only these known additive columns to be installed by the new migration.

Both GET /api/google-drive/status and successful POST /api/google-drive/disconnect
return boolean revocation_pending. A disconnect returning an error still clears
locally and saves retry work; clients should refetch status after the error.
Parent owns the UI: disable reconnect while pending, show pending permission
removal, and expose Retry permission removal calling disconnect. No frontend
changes were made by this task; parent has confirmed responsibility for them.

## Authorization Evidence and Remaining Scope

- Receipt access checks personal ownership or shared wallet visibility/edit
  grants, including both transfer wallets. Raster validation checks format,
  MIME agreement, decoded size, pixels, and integrity.
- Space membership/current wallet grants and role checks constrain reads/writes.
  Existing Space regressions cover isolation and permission revocation.
- Attachments now require allowlisted matching base64 data URLs and a decoded
  4 MB bound. Drawings require PNG; unsafe legacy frontend links are suppressed.
  Account restore applies the same URL validation. This does not scan downloaded
  documents for malware. Seven backend and frontend boundary regressions cover it.
- Reset-request limits remain email-based; rotating addresses can bypass aggregate
  request limits. Proxy client-IP behavior needs deployment verification.
- Limiter commits caller transactions; concurrent ACL/receipt lock lifetimes need
  further coordinated review.
- A crash between provider token issuance and durable local persistence remains
  an unavoidable external transaction gap. Expired/stalled OAuth exchange cleanup
  and manual provider permission removal remain recovery considerations. Google
  project-wide revocation may also affect sign-in scopes in shared projects.

## Verification and Coordination

The parent reports actual **eight-worker PostgreSQL race tests passed**, including
new/expired limiter buckets and password reset. This is real parent integration
evidence, not merely SQL compilation. It predates the new Drive queue: do not
interpret it as a live PostgreSQL queue/consent/migration race result.

New desired regressions cover retained retry credentials, explicit retry,
signout/reset consent rejection, lease recovery/stale completion, deletion and
retry from a fresh session, late grants, account isolation/reconnect blocking,
daily worker dispatch, bounded job count/backoff, and migration preservation.
The old defect characterizations were converted to assertions of correct behavior.
SQLite queue claims run with eight concurrent workers; PostgreSQL DDL/update
compilation is checked. Fresh/upgraded/pre-Alembic SQLite migrations are exercised.
Actual new queue/consent PostgreSQL race and migration integration remains for the
parent's disposable database harness; no local PostgreSQL process was available
to this task. Live providers remain outside regression verification.

Edited files: api/google_drive.py, api/account_security.py, api/models.py,
api/provider_revocation.py (new), api/operations.py, api/schema_migrations.py,
migrations/versions/f43c912ab706_drive_consent_revocation.py (new),
tests/test_security_review.py, tests/test_google_drive.py,
tests/test_schema_migrations.py, and this document. api/google_auth.py retains
the earlier reviewed changes and needed no further edits. api/index.py and parent
frontend/backup/recovery work were left untouched.

Focused tests use C:/Python313/python.exe, PYTEST_DISABLE_PLUGIN_AUTOLOAD=1,
an in-memory/synthetic SQLite URL and APP_SECRET. Providers use MockTransport or
synthetic functions. TestClient requires the approved sandbox-external local
asyncio socket-pair run on this Windows host.
