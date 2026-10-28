# Reliability follow-up — v6.5.6

The follow-up review found reproduced failure paths rather than assigning a
rating from test counts. All reproduction, concurrency and load mutations use
isolated synthetic databases. No production ledger cleanup or migration is needed.

## Scheduled entries

Plan creation now saves its idempotency receipt atomically with the plan. Replaying
the same request cannot create a second future debit. Changed payloads using the
same key conflict. Authorization is checked before replay, including after access
changes; a committed creation can replay after its due time.

Current wallet permissions apply to plan editing, deletion and the `can_edit`
response. A creator downgraded to Viewer loses modification rights. Computed
revisions protect updates after locking the current row, without changing the
database schema. The editor preserves conflicting drafts and offers an explicit,
confirmed reload. Old Android clients must update before editing plans because
they do not send revisions; creation and scheduled posting remain available.

## Offline saves

IndexedDB read/write transactions coordinate discard with sync across tabs.
Sync rechecks stored records instead of trusting its initial batch snapshot.
Only entries known never to have been attempted can be discarded. Attempted
and legacy uncertain entries retain their idempotency key and require retry to
confirm the server result. Deleting a local record is never described as undoing
a server commit. Account changes cannot turn an old queue response into new
account UI state.

## Browser worker compatibility

One root-scope worker now contains both push handling and offline shell caching.
Previously, registering either worker replaced the other for that scope. The old
`/sw.js` URL imports the combined worker so older web bundles remain compatible.
Financial API requests are still excluded from the worker cache. The build
verification exercises both registration paths, offline navigation and update push.

## Ongoing regression checks

The complete quality workflow gates Android publication. It now includes a
32-worker PostgreSQL load/reconciliation job and a reusable real Chromium offline
journey, plus cross-tab IndexedDB tests. Browser checks use synthetic password
sign-in, offline reload, loss of a committed response, idempotent reconnect and
account isolation. Neither job has production credentials. See LOAD_VERIFICATION.md
and BROWSER_RELIABILITY.md for isolation and test boundaries.

Compatible Vite, Vitest and transitive dependency patches address advisories
identified by npm during this review. Development tooling is not served as the
production API; audit results remain time-specific.

## Remaining boundaries

These checks cannot prove a monthly free-service quota will suffice, continuous
uptime, every browser/device combination, or an independent security certification.
Keep all-copy backup retention as requested; free storage capacity must be watched.
Independent account archives complement provider database recovery and are not a
byte-for-byte rebuild of authentication sessions and the entire database.
