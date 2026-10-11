# PostgreSQL database recovery rehearsal

This is deliberately separate from account JSON import. The latter remaps an
account's financial records; a database dump retains identities, relationships,
operational tables and credentials. Never restore this test archive into production.

Use a fresh Python process, local PostgreSQL 17 tools and two dedicated databases
on an isolated server listening only on loopback. Both database names must begin
with budgetly_verification_. No production URLs, credentials or environment files
are needed. The target must contain no user tables, views or sequences.

```powershell
python -m scripts.rehearse_database_recovery --source 'postgresql+psycopg://postgres@127.0.0.1:55432/budgetly_verification_rehearsal' --target 'postgresql+psycopg://postgres@127.0.0.1:55432/budgetly_verification_restored' --pg-bin '.verification/toolchain/postgres17/pgsql/bin' --workers 8 --output '.verification/database-recovery-new.json'
```

The concurrency harness clears inherited service settings and creates an owned
random schema. After its seven scenarios pass, recovery adds synthetic Space
members, receipts, note attachments, sharing, budgets, goals and debts. pg_dump
creates a custom-format archive, which passes Fernet encryption/decryption before
pg_restore imports it into the separate empty target. Every table's row count
and complete row-content digest must match. Driver/subprocess failures do not
print connection details. Archive files are temporary and contain synthetic data.

Before whole-database export, the source must contain only the harness-owned random
schema's API fixture tables, indexes and owned sequences. Its table inventory must
exactly match the loaded API metadata. User relations in public or any other schema,
unexpected fixture tables, unowned sequences, additional user schemas, routines and
standalone types cause refusal before pg_dump. An empty public schema is permitted.
Use an otherwise empty disposable source database with no concurrent writers; the
catalog guard is not a lock against an administrator adding objects during export.

Recovery also compares every sequence's definition, ownership, last_value and
is_called before probing the restored database. A schema-qualified synthetic user
insert must allocate an ID greater than existing user IDs. Every owned sequence's
nextval must exceed the maximum existing value of its owning column; cyclic or
nonincreasing fixture sequences are refused. The insertion is rolled back on success
or failure and table fingerprints are checked again. PostgreSQL sequence advances
are not transactional: the disposable target retains the probe's consumed values.
The source's sequences are never advanced by recovery verification.

Evidence adds source_exclusive, sequences, sequence_state_equal,
sequence_next_values_safe and post_restore_insertion_safe without exposing object
names, IDs, credentials or row contents. Unit tests run without PostgreSQL:

```powershell
python -m pytest tests/test_database_recovery.py -q
```

The source schema is cleaned up by its owning harness. The target remains populated
for inspection and is refused on a second run. Stop the disposable server afterward;
do not point this script at an existing database to empty or overwrite it.

On 2026-10-11 the strengthened rehearsal passed on PostgreSQL 17.11 with eight
concurrent workers. All 49 tables and 86 rows matched after encrypted dump/restore;
the exclusive-source guard passed, all 29 sequence definitions and states matched,
sequence next values were safe, and post-restore insertion was safe. Measured
archive recovery was 1.119 seconds on this machine. Evidence is recorded in
`.verification/database-recovery-622-final.json`. This tiny synthetic duration is
not a recovery SLA.
Account JSON rehearsal separately covers recurring/planner links and precise balances.

Not proven: production Neon retrieval/PITR, independent storage availability,
encryption-key escrow, roles/grants restoration (this local dump uses no-owner and
no-acl), realistic database volume, provider outage, migrations, RPO or RTO. A real
disaster plan must include those and a protected copy of required configuration.
GitHub now repeats PostgreSQL concurrency checks on pushes and pull requests;
the physical dump/restore rehearsal remains an explicit operator exercise.
