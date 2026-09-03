# FlowBudget validation report

## Automated backend regression

Command:

```bash
python -m pytest -q tests/test_api.py -p no:cacheprovider
```

Result after the multi-user/admin upgrade: **4 passed**.

Coverage exercised by the integration suite:

- Login-required protection for budget endpoints
- Admin login and current-user profile
- Admin user create, list, edit, password reset and delete
- User/admin role authorization boundaries
- Per-user starter workspace isolation
- Wallet listing and derived balances
- Expense creation and source-wallet balance change
- Wallet-to-wallet transfer source/destination balance changes
- Transaction deletion
- Recurring transaction due-occurrence generation and validation
- Fixed-precision three-decimal balance arithmetic
- Transaction/category type consistency guards
- Budget creation and retrieval
- Goal contribution flow
- Debt payment flow
- Backup export
- Backup restore with per-user ID remapping
- Dashboard after restore
- Calendar endpoint after restore
- Protection against deleting wallets that still have transactions

## Source-level checks

Performed locally:

- Python module compilation with `compileall`
- Shared frontend API client syntax check with `node --check`

## Frontend package/build limitation

The local npm install stalled in this environment before creating `node_modules`, so Vitest, ESLint and the Vite production build were not completed locally. The project keeps the scripts in `package.json`; Vercel will run the production install/build during deployment.
