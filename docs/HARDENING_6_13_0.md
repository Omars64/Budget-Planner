# Reliability and data-integrity hardening — 6.13.0

Date: 2026-11-03. Scope: all eight reliability priorities. No production records
were used for tests, restored, deleted, or moved. No new paid service or database
migration is required by these changes.

## Delivered

| Area | Review and result |
| --- | --- |
| Financial integrity | Reconciliation acquires the financial owner lock before reading the balance and rechecks access after recurring posting releases that lock. Persisted reconciliation arithmetic stays Decimal. Existing transaction idempotency, transfers and schedule retry paths are covered by integration/concurrency tests. |
| Space isolation | A claimed invitation belongs to its member account ID. Email fallback applies only to an unclaimed invitation. Listing, wallet access and locked financial authorization use the same membership predicate. Existing Owner/Manager/Viewer behavior is retained. |
| Recovery confidence | Backup decoding rejects duplicate JSON fields, nonfinite constants, invalid version types and unknown archive kinds. Local encrypted physical PostgreSQL restore compared every restored table and sequence and proved safe post-restore insertion. Existing backup copies and retention are unchanged. |
| Authentication | Passkey enrollment challenges bind to the confirming session and credential version. Passkey login conditionally advances the verified credential version, rejecting concurrent changes or revocation. Fresh Google identity confirmation remains mandatory. Attachment access and share revocation tests cover private files. |
| Safe releases | Added a disposable PostgreSQL encrypted recovery job to the existing exact-commit GitHub quality gate. Existing migration-preservation, compatibility, browser and Android tests remain required; a failed gate prevents Android publication. |
| Offline consistency | Web Locks serialize replay across tabs where supported. Stable explicit idempotency keys survive retries, account/token identity is checked around asynchronous storage, and failed cleanup after server success remains pending and retryable. Browsers without Web Locks retain server-side idempotency. |
| Operational resilience | Private Admin service-health counts show financial 5xx events, app errors and slow requests over 15 minutes. Three financial request failures make uncached readiness fail and feed the existing GitHub incident workflow. Normal 4xx conflicts/validation/denials do not trigger this alert. Public readiness still reveals only ok. |
| Maintainable structure | Shared operational signals are separate from route handlers. Job and signal views are separate from loading/backup actions. Pure balance-preview, ledger-filter defaults, milestone events, update permission and Planner configuration helpers moved out of React component modules, keeping UI imports separate from reusable logic. Shared switches retain one geometry definition. |

## Data ownership and invariants

- Financial mutations must use existing owner coordination and current workspace
  authorization; cached frontend permissions never authorize a write.
- A transfer is a single transaction affecting both wallet projections. Starting
  balances remain ledger entries, not a second source of money.
- Database Decimal values are authoritative. Browser balance previews are estimates,
  not persisted ledger values.
- A queued entry is pending until server confirmation. An uncertain save keeps its
  original retry key; discarding a device row cannot undo a server transaction.
- Passkeys, sessions and provider grants are account security state, not workspace
  records to import from a budget archive.
- Recovery must use a separate, empty, explicitly selected test target. Keep the
  encryption key outside the hosting account; do not change existing retention
  without approval. No production-target restore is part of this release.
- Operational signals may contain fixed route templates, bounded status codes,
  durations and timestamps. No bodies, tokens, balances or exception details.

## Test isolation

Before application collection, pytest selects disposable SQLite, resets inherited
provider/coordination/database aliases, disables AWS metadata/credential lookup,
and installs an external-network audit guard. Loopback synthetic services remain
usable. Existing fixtures retain a fixed test admin identifier; this is a record
in the disposable database, not a login against the live account. Arbitrary child
processes are not sandboxed by the Python audit hook; dedicated PostgreSQL tools
also validate numeric loopback and verification-only database names.

## Operational limits and follow-up

- These checks establish synthetic behavior, not an independent penetration-test
  certification, guaranteed recovery time, or zero future defects.
- Readiness follows the existing coordination cache/probe interval; alerts are not
  instantaneous. Financial write failures invalidate that cache through the
  existing write coordination. An unavailable event store may prevent an event
  count; safe runtime logs and public readiness remain separate evidence.
- Existing health workflow checks approximately every 15 minutes. GitHub schedule
  delays and repository notification settings affect when an operator sees it.
- Google Search Console ownership is verified, but Google OAuth branding approval
  and Session age claims remain external configuration work. This release does not
  bypass missing auth_time claims or claim real Google-only enrollment passed.
- Provider retrieval of a current production encrypted archive and an outage drill
  are separate from this isolated PostgreSQL restore. Historical live recovery
  evidence is not represented as a new live recovery run.
- Default retention of all independent backup copies remains unchanged; storage
  growth and provider billing still need periodic owner review.

Validation results and release identifiers are recorded after the combined checks.

## Verification before release

- Browser unit suite: 587 passed, 6 opt-in tests skipped.
- Combined backend suite: 1,065 passed; two readiness test mocks needed updating
  for the new aggregate query. The corrected resource-runtime/monitoring suites
  then passed all 132 cases. The release gate must rerun the full suite.
- Recovery/backup/migration focus: 126 passed; mocked release checks: 22 passed.
- Actual local PostgreSQL recovery: 51 tables, 44 rows and 29 sequences matched;
  encrypted roundtrip and safe post-restore insertion passed.
- Real browser: sign-in, IndexedDB offline reload, exactly-once reconnect and
  account isolation passed. Separate cross-tab IndexedDB cases passed.
- Real browser with the final lazy-loaded production CSS: 16 notification switch
  geometry/state cases passed at mobile and desktop widths.
- Private feedback conversation and a real virtual-WebAuthn registration persisted
  through the synthetic backend. Only Google's verified identity response was
  simulated; this is not evidence of the live Google provider configuration.
- Production web build passed. ESLint: zero errors, one existing App-context
  Fast Refresh warning. Existing bundle-size and dependency deprecations remain.

The exact release commit must pass Vercel and all GitHub quality jobs (including
PostgreSQL concurrency/load/recovery and Android JVM checks) before APK publication.

## Release-environment corrections

The first remote release attempt correctly blocked publication. All existing web,
Android, PostgreSQL load and concurrency gates passed, but the new recovery gate
assumed an ignored local folder existed and Vercel rejected a 240 MB Python bundle
against its 225 MB limit.

- Recovery uses an automatically cleaned OS temporary directory and reports only
  an allowlisted error type on failure. A new full mock orchestration regression
  and an actual PostgreSQL restore from an empty working directory both passed.
- Uvicorn and its optional local server extras moved to requirements-dev.txt;
  the Vercel ASGI handler does not need a local development server. The synthetic
  browser workflow installs development requirements for its local server.
- Preview/output artifacts are excluded from the function bundle, and local virtual
  environments/database files are excluded from uploads. Runtime data dependencies,
  exports and backup support remain present.
- Fresh-process ASGI import without Uvicorn plus focused recovery: 41 passed.
- These corrections do not change the already-built Android application assets.
  The APK is held until quality and Vercel pass for the corrected source commit.
