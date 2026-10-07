# Budgetly Spaces design preview

Open http://127.0.0.1:5209/poc/spaces.html while the preview server is running.

This is an isolated, in-memory design prototype. It never calls Budgetly's API,
sends invitations, changes real records, or moves money. Reload resets sample data.
Production code, database schemas and release versions are unchanged.

## Proposed experience

- Personal remains private and is the default workspace for existing records.
- Household and Trip spaces contain their own wallets, budgets and transactions.
- A compact selector switches the financial context, not the signed-in account.
- The space name is visible when recording an expense to avoid misfiling it.
- Shared expense details reveal equal/custom splits only when opened.
- Manage space groups members, controls and activity history behind one action.
- Settlement records acknowledge payments made elsewhere; they are not transfers.
- Desktop uses a sidebar; mobile uses familiar bottom navigation and bottom sheets.
- Dark/light themes and reduced-motion preferences are supported.

## Preview coverage

Interactive space switching, navigation, expense recording, wallet totals,
member invitation preview, approval toggle, split validation, settlement preview
and creating an empty space. Equal splits allocate minor units without losing
or creating a rounding fraction.

Roles, approvals, permissions, invitations, settlement accounting, audit history,
offline sync and persistence are conceptual UI here, not implemented services.
The full product must enforce isolation and permissions in the backend, migrate
existing shared wallets with explicit membership handling, and preserve existing
transaction IDs, balances, attachments and ledger history.

Awaiting design approval before implementation.
