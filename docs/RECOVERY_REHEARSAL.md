# Synthetic Recovery Rehearsal

## Run

From `C:/Users/Omar/Documents/2026/Flow-Budget` in PowerShell:

```powershell
$env:PYTEST_DISABLE_PLUGIN_AUTOLOAD = '1'
& C:/Python313/python.exe -m pytest tests/test_recovery_rehearsal.py -q --tb=short
```

Run this module on its own. Some existing test modules set database environment
variables or enter application startup during collection/execution; this rehearsal
does neither. No dependency downloads, live database, environment files, external
services, deployment, publishing, or version changes are required.

## Isolation

Each case creates six fictional users and a new in-memory SQLite database with
foreign keys enabled. The real application routes use dependency overrides that
open sessions only on that database. The TestClient deliberately does not enter
its context manager, so application startup, production migrations, seeding, and
background jobs never run. Guards reject configured database connections and pool
checkouts; socket connection attempts also fail. Overrides, guards, application
state and the temporary clock patch are removed at teardown. Receipt bytes are a
locally generated 2x2 PNG; the note attachment is a synthetic PDF byte marker,
not a personal document or a PDF rendering test. No persistent database is created.

The confirmation dependency is bypassed only inside the fixture. Authentication
is a synthetic actor dependency, not a login. This does not test passwords,
reauthentication, authorization tokens, rate-limit exhaustion, or network service
availability. Permission checks within the actual Space routes remain active.

## Account Export Versus Whole Database

`GET /api/backup` exports the authenticated account's version-1 workspace JSON.
`POST /api/backup/restore` replaces that account's budget data and, when supplied,
notes. It remaps wallet, category, transaction, recurring-parent, planned-entry,
note-folder and planner references. It preserves the destination PIN, omits PIN
and passkey exports, clears transaction actor attribution, and assigns restored
planned entries to the destination actor. It is not an identity/credential backup.
Existing users allow Space membership emails to resolve to account IDs; pending
members can remain email-only. Global users, other accounts, operational tables,
and full history are outside the account archive contract.

`api/operations.py` external snapshots encrypt and compress this same account
export. An encrypted external snapshot is therefore still an account archive,
not a database image. This rehearsal does not upload or download snapshots.

The separate whole-database case calls SQLite's native `Connection.backup` into
another isolated in-memory database, then checks integrity, foreign keys, and
every row of every table against the source. It also checks preservation of all
six users and a credential setting excluded from JSON export. This demonstrates
physical SQLite recovery semantics; it does not exercise an application restore
endpoint or establish a PostgreSQL disaster-recovery procedure. SQLite recovery
retains IDs, credentials and actor attribution rather than remapping them.

## Coverage

- Same-account replacement and fresh-account import with archived Space IDs
  already occupied by the source owner; each path restores twice.
- Exact three-decimal balances: Cash `86.744`, Bank `27.009`, Shared `49.002`.
  Transfer directions and opening-balance migration are checked without duplicate
  money on the second restore. An unrelated account's `77.777` wallet survives.
- Recurring parent/child links, category links, recurrence end date and reporting
  month distinct from cash date.
- Receipt name and exact PNG data bound to the remapped transaction.
- Personal and Space notes, folder ownership/scope, attachment name/MIME/bytes,
  pinned state, body, page style and checklist.
- Planned, scheduled, posted and failed states, posted-transaction linkage,
  reporting month and reminder state. Posted entries with a missing/null linked
  transaction stay completed and do not post again.
- Personal and Space planner settings, bill wallet/plan/payment remapping,
  restored transaction creation timestamps, revisions, reserve and price history.
- Restored Space view/add/edit grants and outsider denial through real wallet,
  transaction and budget endpoints, on both restore paths.
- Preflight rejection without account replacement for foreign wallet/Space/
  receipt/planner references, unsupported version, duplicate transaction IDs,
  missing note folders, cross-Space transfers and negative money.
- Same-account restoration after metadata edits, role escalation, member removal
  and addition of an outsider. Both metadata and membership regressions pass.
- Whole-database SQLite backup equality, integrity and foreign-key checks.

## Evidence And Parent Fix

On 2026-10-11, after the parent's existing-owned-Space metadata/member replacement
fix in `api/index.py`, the exact command above completed successfully:
**24 passed, 2 warnings in 4.03s**. The run used `C:/Python313/python.exe`,
`PYTEST_DISABLE_PLUGIN_AUTOLOAD=1`, and requested execution escalation. There were
no skipped or expected-failure cases. The warnings are third-party TestClient
deprecations concerning httpx and the AnyIO BlockingPortal alias.

The earlier run had **22 passed, 2 failed**. Both failures in
`test_same_account_restore_reinstates_archived_space_membership`, parameterized as
`metadata` and `members`, now pass. This verifies archived name/color/currency and
membership restoration after post-export edits, including restoring removed
members, reverting escalated roles and removing an added outsider. Fresh-account
Space ID collisions, repeated replacement, permission enforcement, attachment and
planner links, exact balances, and whole-database SQLite equality also pass.
No valid-archive compatibility failure was found with the parent's
`api/backup_validation.py` preflight.

This rerun changed only this evidence document. The parent owns `api/index.py`
and the validator; neither was modified by the rehearsal work.

## Limits

This is a synthetic functional regression suite, not a live recovery drill. It
does not prove production backup freshness, retention, encryption key custody,
object-storage availability, restore duration, PostgreSQL constraints or sequence
handling, filesystem attachments, external identity providers, or provider-level
point-in-time recovery. It does not exercise recurring generation or scheduled
execution during startup. The complete-row SQLite comparison includes operational
table schemas, but most such tables are empty in this fictional fixture.
The suite does not verify the parent's UI preview disclosure of archived access
restoration. It verifies archive membership and separate restored-role endpoint
checks, but does not probe every member's endpoint access after the edited-member
regression. Destination Spaces omitted from an archive are outside that regression.
