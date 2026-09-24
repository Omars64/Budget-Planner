# Budgetly release gate

Keep the existing design. Overview must never offer Add transaction.

## Automated checks

1. Choose the semantic version from all changes since the previous release: fixes only increase Patch; backward-compatible features increase Minor and reset Patch; breaking changes increase Major and reset Minor/Patch. Apply the highest applicable change as part of release work, without waiting for a separate version request. Set `version` and a higher `androidVersionCode` in package.json only; Android's code increases independently of the semantic version.
2. Run `npm run version:sync`. Commit package.json, package-lock.json and api/_version.py. Android and the browser read package.json directly.
3. Run `npm run release:check` (version consistency, lint, frontend tests, production build).
4. Run `python -m pytest tests` against an isolated test database, never production.
5. Review Alembic revisions and rehearse them on a restored test database. Confirm a recent external backup and a successful monthly restore test.
6. Run `npm run android:sync`, then build the APK with `npm run android:apk -- -Release`.
7. Stop local Vite preview processes before `npm ci` on Windows; loaded native modules cannot be replaced.

## Windows dependency installation

Stop the Vite development or preview server in this checkout before reinstalling dependencies. If Node cannot verify the registry certificate on this machine, use the Windows trusted certificate store for the current PowerShell session:

```powershell
$env:NODE_USE_SYSTEM_CA = '1'
npm ci --offline=false
```

Keep TLS certificate verification enabled. Restart the development server only after installation finishes.

The `xcode` dependency has a scoped `uuid` override to 11.1.1 for GHSA-w5hq-g745-h8pq. It retains the CommonJS `uuid.v4()` API used by Xcode tooling. Review this override when upgrading Capacitor or `xcode`, and remove it once the upstream dependency includes a patched compatible version.

## Browser and physical Android acceptance

- Test light/dark themes at 360px, 390px and desktop widths, plus enlarged text.
- Overview has no Add transaction control. Current balances and selected-month records are distinct; shared totals remain separate.
- Create income, expense, transfer and opening balance. Follow summary links and reconcile records with totals; transfers are not income.
- Create/edit personal and shared entries with the keyboard open. Drag sideways: no form displacement. Back closes the top picker/modal first.
- Search/select wallets and categories; apply a template, review and save. A missing wallet or revoked permission must not save silently.
- Fail a save, retain the draft, reconnect and retry without duplicates. Concurrent edits must produce a conflict, not overwrite silently.
- New-entry drafts are stored per account on this device for up to seven days after session loss. Discard draft removes them; signing out clears transaction drafts. Templates remain device-local and account-scoped.
- Delete then Undo; verify restored balances. A shared editor cannot access the owner's Trash.
- Verify shared viewer/add/editor/owner permissions and revoked-access refresh.
- Goals and debts explicitly track progress only, without silently moving wallet funds.
- Verify tutorial skip/replay, notification permission, scheduled delivery with app closed, profile visibility and footer clearance.
- Export owner and shared-viewer wallet statements for a selected date range in CSV, XLSX, PDF, and Word. Check opening/running balances and Android sharing. Confirm JSON restore remains separate.

Do not claim physical-device notification delivery, signed-release success, or deployment unless those checks actually ran. Retain the prior APK/deployment for rollback; do not roll back a database blindly.
