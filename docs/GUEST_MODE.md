# Guest Mode (Budgetly 5.9.0)

## Access

Continue without an account on login or signup enters a persistent local workspace.
Overview (including recent activity), immediate personal transactions, two active
wallets including Main, budgets, analytics, and limited Settings are available.
Shared records, upcoming/scheduling/repeats, attention, calendar, goals/debts, AI,
notes, bank messages, account security, biometrics, notifications, recovery, cloud
backups, and advanced financial-ledger tools require an authenticated account.
Both navigation and direct-route access are guarded. Backend routes continue to
require real authentication; a guest role is never accepted as a server identity.

## Storage and export

Financial records use the versioned `budgetly_guest_workspace_v1` localStorage
key, separate from authenticated offline caches. Web Locks serialize writes
across tabs on supported browsers/WebViews. Financial guest requests never go
to the API. No fake account or bearer token is created. Corrupt data is not
silently reset; failed/quota-limited writes leave the last saved copy intact.
Clearing browser/app storage, uninstalling, or changing devices can lose this
workspace. A concise warning is shown before entry and in Guest Settings.

Guest Settings provides headed, escaped CSV transactions (including starting
balances) and a full JSON local copy. The latter is a guest snapshot, not the
existing account backup/restore format. Spreadsheet formula-leading text is
escaped. Guest deletions are permanent; their confirmations never promise Trash
or recovery. Currency choices label amounts; they do not convert them.

## Account import

After password, email-verification, passkey, or Google sign-in, users with local
records can confirm adding them to the named account, or keep them locally.
Settings offers the same import later. No existing data/settings/shared records
are replaced. Wallets are newly created; matching category name/kind can reuse
an existing category. Guest and account currencies must match; no silent
conversion occurs. Opening balances retain their original dates and are
materialized once by the existing ledger accounting helper.

`POST /api/guest/import` requires authentication, bounds payload size/collections,
validates all references and types, and commits all records plus an audit event
and idempotency receipt in one transaction. The server derives the receipt key
from workspace UUID and account, so a lost response/retry cannot duplicate data.
Different contents with the same key are rejected, not reimported.

When confirmed, the client freezes a snapshot and saves the pending import with
its destination account. Guest writes pause until it is resolved. Retrying after
refresh uses the same snapshot; another account cannot silently take over.
The local workspace is cleared only after success and only when UUID/revision
still match. A scheduled transaction draft is mapped to the imported wallet and
category IDs, then reopened for review; it is never recorded automatically.

## Verification

- Local data tests: persistence, no financial network calls, wallet cap,
  transfers/opening balances, reporting months, budgets, filters/pagination,
  stale edits, linked deletion, restricted endpoints, CSV escaping, storage
  failures/corruption, and pending import preservation.
- UI tests: slide-up transition, guest restoration, direct-route protection,
  explicit import consent, failed-response retry, account binding, draft mapping.
- Backend tests: additive import, duplicate prevention, invalid references,
  invalid categories/recurrence/month/currency, and authentication.
- Browser walkthroughs: desktop/mobile-size entry, local save/reload, wallet cap,
  Settings, dark mode, restricted direct navigation, and no financial API calls.

Before publishing: install the signed APK over the existing app without
uninstalling, verify guest persistence across force-close/restart, test Google and
email signup followed by import, and confirm Android CSV/JSON sharing. A browser
viewport test is not a physical-device keyboard/install test.
