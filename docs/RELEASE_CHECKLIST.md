# Budgetly release gate

Keep the existing design. Overview must never offer Add transaction.

## Automated checks

1. Set `version` and the increasing `androidVersionCode` in package.json only.
2. Run `npm run version:sync`. Commit package.json, package-lock.json and api/_version.py. Android and the browser read package.json directly.
3. Run `npm run release:check` (version consistency, lint, frontend tests, production build).
4. Run `python -m pytest tests` against an isolated test database, never production.
5. Run `npm run android:sync`, then build the APK with `npm run android:apk -- -Release`.
6. Stop local Vite preview processes before `npm ci` on Windows; loaded native modules cannot be replaced.

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

Do not claim physical-device notification delivery, signed-release success, or deployment unless those checks actually ran. Retain the prior APK/deployment for rollback; do not roll back a database blindly.
