# Budgetly 5.4.0

Android version code: 39. Existing signing identity is unchanged.

## Changes

- Mobile wallets use one full-width card per row. Bank/card colors no longer inherit the generic glass surface. Twelve preset colors and a custom picker are available, with automatic text contrast.
- Monthly budgets can target an optional reporting month. Leaving it empty preserves the existing repeating-month behavior. Dashboard and attention lists show targeted budgets only in their applicable month. Record drilldowns use the same reporting month as the totals.
- Notes has grid/list browsing, a compact icon toolbar, and expandable side-by-side Folder/Paper settings. Autosave, version checking, sharing, attachments and export remain available.

## Data safety

Migration `a31e907c42bd` adds one nullable column to budgets. It does not modify transactions, wallet balances, notes or existing budget limits. Existing budgets retain a null month and continue repeating. JSON backups include the new field; older backups remain compatible. Restore validates budget months before replacing account data.

## Verification

Run `npm test -- --run --maxWorkers=2`, `py -m pytest tests -q`, `npm run lint`, and `npm run android:apk -- -Release`.

`scripts/verify-wallet-notes.cjs` checks an isolated local API through the preview on port 5173. It uses a temporary test account and browser-emulated Android platform; it does not test physical-device plugins. Never point this script at production. Preview API must use a temporary database and the test-only password shown in the script.

Before promoting production, confirm the new migration reaches head and check a real Android device for card colors, selected budget month, Notes controls, keyboard behavior and autosave.
