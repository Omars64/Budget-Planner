# Budgetly 6.0 Spaces

Personal remains the fresh-login context. Creating a new space is explicit;
accounts without legacy shared wallets do not receive an automatic space.

## Existing shared records

Alembic revision c620a19e7f30 attaches existing shared wallets to Home Expense.
It does not recreate wallets, transactions, receipts or scheduled entries.
Wallet IDs, recorded-by identities and original access grants are retained.

Wallets are grouped only when their owner and exact member permissions match.
Different ownership or permissions produce separate Home Expense spaces instead
of broadening access. The same person may therefore see more than one migrated
Home Expense; the owner can rename them independently.

Space roles are Viewer (read), Contributor (add entries), Manager (manage
financial records), and Owner (including theme and membership management).
Account security, administration and backups always use the authenticated
account, not the space owner's identity.

## Release safety

Keep a verified production database backup before deployment. Deploy the API
and migration before distributing the Android APK. The release batch pushes
the source before building/publishing the APK; check the Vercel deployment
completed successfully before asking users to install it.

An old APK can still use the legacy sharing endpoints. If it changes a migrated
wallet's permissions independently, space access fails closed until the owner
reviews membership. Users should update to v6 before changing shared access.

JSON backups include owned spaces and member permissions. Restore remaps
financial IDs and Planner links, validates space references before replacement,
and retains current membership on an existing owned space. Account recovery
backups include the complete owner's workspace, not just the selected space.

This migration has been tested on isolated fixtures representing the two Omar
accounts. Production account data is not changed until the API is deployed.
