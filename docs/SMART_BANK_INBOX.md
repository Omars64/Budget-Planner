# Smart Bank Inbox (Budgetly 6.1.2)

## Implementation Map

- Android: `BankNotificationListenerService` captures allowlisted notifications; SQLite in the app-private no-backup folder holds temporary data.
- Capacitor: local `BankNotifications` plugin controls consent, app selection and acknowledgements. No SMS, Accessibility, bank login, external listener, foreground service or paid API.
- Frontend: `src/lib/bankNotifications/parser.js` parses on-device. `native.js` uploads structured fields on sign-in/resume/online, then acknowledges.
- Backend: `/api/bank-inbox` stores private candidates and mappings. Approval uses `api.index.add_transaction`, the same transactional helper as manual entry.
- Spaces: mappings resolve the destination wallet and Space; scoped approval enforces existing membership and wallet/category rules. Alerts are private to the capturing user, not exposed to every Space member. Approved ledger records follow normal sharing.
- Existing manually forwarded messages are preserved in a read-only archive under Previously saved bank messages in Personal. Forwarding keys and the old setup guide are retired; old keys cannot submit alerts. No saved records are discarded.
- Configure capture only in Settings > Smart Bank Inbox. Selected apps survive session suspension; capture resumes only when the same account signs in. Signing out or switching accounts pauses capture. Android notification-access revocation remains visible in Settings and requires the user's permission to restore.

## Android Setup

1. Install this version. Sign in, open Settings > Smart Bank Inbox.
2. Read the consent description, open Android settings and explicitly grant Budgetly notification access.
3. Select banking/payment apps under Apps to monitor. Nothing is selected by default.
4. Map each app/card ending to an existing wallet. Choose Personal or a Space. An empty last-four mapping is the fallback for that source.
5. A future notification from an enabled app is queued even when the WebView is closed. Reopen/resume Budgetly while online to import it. Review & add confirms the ledger entry.

Unmapped alerts land in Personal. Use Move alert to wallet to route them to a Space; then open that Space's Bank Inbox. Mapping changes apply to future alerts, not already queued candidates.

Sign-out suspends capture; selecting apps again explicitly resumes it. Queued data belongs to the original account ID and cannot be imported into a different signed-in account. Notification access is different from Android's permission to display Budgetly notifications. No automatic approval or background server synchronization is included.

## Privacy and Retention

Security-code messages are rejected before native persistence and again by the JS parser. Full long card/account numbers are redacted locally; only detected last four digits leave the device. Raw notification bodies are never uploaded by this integration. Hashes, source app, amount, currency, merchant, last four, confidence and timestamps are stored in the existing Budgetly backend. No content is logged.

Temporary raw queue: app-private, excluded from OS backup, expires after 30 days; maximum 1,000 notifications, batches of 100. Overflow/capture errors are visible in setup. Unsupported non-transaction alerts are discarded on-device. Recognized items remain queued if upload fails. Server inbox is bounded to 500 pending alerts per account.

Approved entries are ordinary transactions and included in normal backups, analytics, balances and recurring analysis. Pending inbox items, local app allowlists and merchant memory are not included in financial JSON backups. Deleted wallets remove their routing mappings; pending alerts can be routed to another wallet. Account deletion removes server candidates and mappings through account foreign keys. Local temporary data is retained until acknowledgement/expiry or uninstall.

## Parser and Supported Formats

- Unicode normalization and Arabic/Persian digits; KWD/KD/K.D./د.ك amounts before/after numbers and comma thousands.
- Signed amounts work across bank formats: `+1.000KWD`, `+ KWD 1.000`, `KWD -1.000` and supported catalog currencies. Plus suggests a credit, minus a debit; explicit positive refunds and negative ATM withdrawals retain their specialized handling. A currency code is required; bare amounts and ambiguous currency symbols are not guessed.
- Balance/available/limit-labelled amounts are excluded before selecting a payment. A signed payment is preferred over unsigned amounts; multiple possible payments reduce confidence. Signed-only drafts have medium confidence and an explicit direction-review message. This is generic format support, not a guarantee that every bank notification can be parsed.
- CBK WAMD signed alerts (`CBK +1.000KWD YOU Ac 9010 WAMD Available 20.488KWD`) use the signed payment, never the available balance. Credit/debit drafts require review, including whether this was a transfer between the user's own wallets.
- Catalog currencies supported at their decimal precision, with existing three-decimal ledger limits. No FX conversion.
- Refund/reversal before income, then ATM withdrawal, transfer and expense. Security/marketing/balance-only alerts are rejected.
- Known Talabat aliases are normalized; unknown merchants are not invented. Missing names stay Unknown merchant.
- Posting time is the initial date/time; review it when a notification describes an earlier event. Ambiguous multiple amounts reduce confidence and are shown for review.
- Known app + last four maps to a wallet. Merchant category memory is private to user/Space/type; existing matching-description history is a fallback.

## Approval and Duplicate Safety

User-row lock plus candidate atomic claim, normal wallet/category validation, ledger insertion and candidate status commit together. Re-approval returns the existing transaction ID. Invalid references roll back the claim. A unique user/content-hash constraint handles redelivery/retries.

Similar transactions with the same wallet/type/amount within 24 hours require explicit Add anyway. Matching is intentionally conservative; equal-value distinct payments may need confirmation. Statement import's existing three-day matching includes approved bank transactions, because these are normal records.

Transfers and ATM withdrawals initially require a destination wallet; users may explicitly choose expense for payments outside their wallets. Refunds use a normal wallet credit with a refund source note and optional original expense link. The existing ledger has no separate refund transaction type; money-in reports include these credits, not a dedicated refund metric. Income/refund recording requires selecting a reporting month.

## Testing

- JS parser fixtures: `tests/fixtures/bank_notifications/synthetic.json`; parser and native acknowledgement tests in `src/lib/bankNotifications`.
- API tests: `tests/test_bank_inbox.py`, existing bank-message, Spaces and migration suites.
- Full frontend/backend tests, lint, production build and Android debug compilation.
- Debug APK only: enable Synthetic Bank (debug only) in app selection, grant notification access and notification display permission. Run `adb shell am start -n com.flowbudget.app/.FakeBankNotificationActivity`. This posts a synthetic purchase while the Budgetly WebView can remain closed. The activity is absent from release APKs.

On a real phone verify disabled listener, no selected apps, selected-app capture, closed-app capture/reopen, repeat redelivery, failed upload/retry, account change, duplicate approval, refund, ATM and Space routing. Test Samsung restrictions and permission revocation. Android may withhold sensitive/redacted bank notifications or stop delivery after Force stop; this is not an account sync API and cannot recover alerts the OS did not deliver. Browser/iPhone support paste and review only.

## Adding Rules

Add deterministic bank-format fixtures and parsing rules in `parser.js`, retaining generic fallback, security filtering, decimal strings and conservative confidence. Do not hard-code unverified package names or auto-enable apps. Require reviewed tests for each new rule.

## Verification Status

Verified on 8 October 2026:

- 280 frontend tests across 66 files and 264 backend tests passed.
- Production web build, version consistency and Android debug APK compilation passed. Lint has no errors; existing repository warnings remain.
- Isolated local browser test: paste a synthetic purchase, choose wallet/category, approve, and confirm the ordinary transaction and updated balance. Desktop and 412px mobile layouts were inspected in light/dark appearance.
- Space routing, actor-private inbox isolation, normal ledger approval, revoked/view-only access, retry deduplication, refund/ATM behavior, currency checks and migrations are covered by automated tests.

The 6.1.1 CBK patch additionally passed 50 focused parser/bridge/review tests and six Bank Inbox API tests. The new fixtures cover signed WAMD credits/debits, Arabic digits, foreground-service notices, malformed amounts and security-code rejection. Previously discarded unsupported alerts are not replayed automatically; paste them for review or test a new notification after upgrading.

The 6.1.2 general signed-amount patch passed 318 frontend tests (66 files, two workers), six focused Bank Inbox API tests, the production web build and Android debug APK build. The initial concurrent-build test run had an unrelated update-delivery timing failure; the complete reduced-concurrency rerun passed. Real-device capture remains a separate verification step.

Real-device listener permission, manufacturer behavior and closed-app capture cannot be marked verified without a connected device/user test. No production account records were used or modified in synthetic tests. Nothing was pushed or published by this implementation.
