# Critical integration journeys

`tests/test_reliability_journeys.py` adds three cross-feature regression journeys.
They use real password hashing, login, signed bearer tokens, persisted account
sessions and identity confirmation. Authentication and permission dependencies
are not mocked. Manager is the API's `edit` role; viewer is `view`.

| Journey | Connected behavior and assertions |
| --- | --- |
| Signed-in ledger collaboration | Owner creates a space, invites manager/viewer and creates a wallet. Owner and manager create expenses and correct each other's entries with revisions; stale edits conflict. Viewer sees the entries but cannot create, edit or delete. Owner revokes manager membership; the existing bearer session immediately loses read/write/delete access. Regrant restores access to that same session. Manager and owner delete each other's entries and balance returns to 100 KWD. Outsider access is denied. |
| Schedule, retry, restore, retry | Manager schedules a future expense. An unauthorized maintenance request cannot post it. At the simulated due time, authenticated maintenance posts once across repeated calls; database assertions check owner, recorder, amount and plan linkage. Owner exports an archive, confirms identity and restores it twice. Maintenance retries after each restore create no duplicate expense; viewer sees the recovered balance of 97.750 KWD and the posted plan points to the restored transaction. |
| Revocation before due time | Manager schedules an expense, then owner removes membership through the API. Repeated maintenance calls after the simulated due time leave the plan failed, create no expense and preserve the wallet balance. |

## Isolation

- Existing `tests/conftest.py` replaces the configured database URL with a
  disposable synthetic SQLite URL before importing application modules.
- Each journey uses its own temporary SQLite file, foreign keys enabled, fresh
  schema and synthetic users at `journey.test`. Both request `get_db` and the
  separate token-issuing `SessionLocal` factory bind to that file.
- Global-engine connect/checkout attempts and `socket.create_connection` fail
  immediately during each fixture. Dependency overrides are cleared for the
  journey and restored afterward; readiness and factory patches are restored too.
- `TestClient` is deliberately never entered as a context manager. No application
  lifespan, startup seed or background job runs. Due timestamps alone are moved
  in the isolated database; posting executes through the maintenance HTTP route.
- No external identity, email, push or backup provider is needed. Backup restore
  uses the account archive HTTP API, with actual password confirmation.

## Running

Run from the repository root. This command removes every database URL alias
recognized by `api/database.py` in the Python child process before pytest imports;
the parent shell environment remains unchanged.

```powershell
python -c "import os; [os.environ.pop(k,None) for k in ('FLOWBUDGET_DATABASE_URL','FLOWBUDGET_POSTGRES_URL','DATABASE_URL','FLOWBUDGET_URL','POSTGRES_URL','FLOWBUDGET_DATABASE_URL_UNPOOLED','DATABASE_URL_UNPOOLED','FLOWBUDGET_URL_UNPOOLED')]; import pytest; raise SystemExit(pytest.main(['tests/test_reliability_journeys.py','-q','-p','no:cacheprovider']))"
```

## Scope and limits

These journeys complement `test_spaces.py`, `test_space_managers.py`,
`test_planned_transactions.py`, `test_recovery_rehearsal.py` and the existing auth
and recovery suites. They intentionally omit their full role, corrupt-archive,
receipt, attachment and migration matrices. The wallet's opening-balance entry
is retained; expense assertions distinguish it from journey purchases.

SQLite sequential retries demonstrate application-level idempotency, including
after restore. They do not establish concurrent-worker correctness on PostgreSQL,
physical disaster recovery, browser behavior, OAuth/passkey behavior, notification
delivery or deployed startup correctness. Existing physical recovery coverage
remains in the recovery suites. No production resources are used.
