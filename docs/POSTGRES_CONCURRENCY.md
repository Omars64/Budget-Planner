# Disposable PostgreSQL concurrency verification

Run from the repository root in a fresh Python process after reviewing the harness.
The parent supplies disposable local PostgreSQL (Docker or portable PostgreSQL).
No production credentials, external APIs, deployment, version changes or publishing
are involved. Dependencies are already listed in `requirements-dev.txt`, including
SQLAlchemy, psycopg, pytest and httpx.

```powershell
python -m pytest tests/test_postgres_verification.py -q
python -m scripts.verify_postgres --url 'postgresql+psycopg://postgres@127.0.0.1:55432/budgetly_verification_rehearsal' --workers 4 --output .verification/postgres-concurrency.json
```

The database must already exist. Trust authentication without a password is accepted
on the explicit numeric loopback endpoint. The URL is required; environment aliases
are never consulted. Only `127.0.0.1` or `::1`, an explicit port and user, and a database
matching `budgetly_verification_[a-z0-9_]+` are accepted. URL query options are rejected
to prevent libpq host/service/search-path overrides. All inherited environment entries
except basic OS execution paths are cleared before any database connection or API
import, including `PG*`, backup, mail, push, admin seed and database alias settings.
The harness sets `PGPASSFILE` to the null device and disables SSL on this disposable
loopback connection, preventing default password-file and client-certificate lookup.

Every run creates a random schema with an exclusive `CREATE SCHEMA` (no `IF NOT EXISTS`).
An existing nonempty database is safe because application connections have a search
path containing only this new schema, with no public fallback. Tables are created from
the application metadata; this verifies current ORM behavior, not Alembic upgrades.
The harness records the created schema's OID and drops only that schema in `finally`,
after disposing application connections. A changed/missing OID causes cleanup refusal.
It never creates or drops a database or removes preexisting schemas. Abrupt process
termination can leave the random schema behind; an operator must establish ownership
before manually removing anything. Use a dedicated local role/database without other
writers; the harness is not designed to defend against a hostile database administrator.

The in-process ASGI fixture follows existing API dependency override patterns, with
one independent SQLAlchemy Session per request and a synthetic authenticated user.
It deliberately bypasses application lifespan, migrations, demo/admin seed, scheduler
and network delivery services. Explicit `post_due` workers each have their own session.
Python socket connections are blocked except the selected PostgreSQL endpoint and
internal asyncio socketpair creation. Psycopg/libpq opens native sockets; its destination
is constrained by the validated URL and cleared environment, not Python's socket guard.

Each batch starts 2..16 threads at a barrier and verifies:

- Concurrent identical transaction keys return identical responses and persist one row
  and one receipt.
- Different keys persist one distinct row and receipt per request, even with identical
  financial payloads.
- Competing `post_due` workers collectively post every due plan once; every plan links
  to a distinct existing transaction and a subsequent worker finds no work.
- Concurrent bank candidate approvals return one transaction ID and persist one
  approved candidate and one merchant memory; replay retains that transaction ID.
- Concurrent security limiter calls race both a new bucket and an expired bucket.
  Exactly the allowance succeeds, all excess calls return 429, and the persisted counter
  includes every attempt. These calls exercise the real limiter with separate sessions.
- Concurrent reset-completion API calls compete for one synthetic token with different
  passwords. Exactly one succeeds, losers and replay return 400, the token is consumed,
  the session is revoked, one completion audit exists, and only the winner's password works.

After every scenario, fresh sessions verify exact total transaction and receipt counts,
one opening balance entry, wallet/user ownership, and an exact Decimal balance.
The ledger API balance must also match. No exception/status is accepted as an expected
concurrency failure; any failed worker fails the run. Database statement and lock timeouts
bound stalled queries. Timing is evidence of the concurrent rehearsal, not a benchmark
or a guarantee that every possible interleaving was exercised.

Success evidence includes only scenario names, pass flags, worker counts and aggregate
elapsed/min/max timings. It omits URLs, credentials, schema names, user/transaction IDs,
payloads and financial values. Existing evidence files are never overwritten. Exit codes:
0 success, 1 scenario/database failure, 2 invalid arguments. Unexpected exceptions are
redacted because driver messages can embed connection details; synthetic assertion
failures retain their assertion name. Production API defects require a report to the
parent; the harness does not patch API modules.

Unit tests use fake schema connections, fresh CLI subprocesses and synthetic threads.
They do not connect to PostgreSQL. The parent runs the integration command separately
after patch review and PostgreSQL provisioning.

## Parent dump/restore hook

The Python entrypoint accepts an optional trusted local callback. No `--pg-bin` flag is
needed: the parent owns PostgreSQL binary discovery and dump/restore implementation.

```python
from scripts.verify_postgres import run

def rehearse_dump_restore(dburl, schema):
    # The verified fixture still exists here. Run the parent's local rehearsal.
    # dburl is a SQLAlchemy URL string with the isolated search_path query option.
    # Parse it; do not pass the +psycopg URL directly to pg_dump or publish it.
    pass

evidence = run(
    'postgresql+psycopg://postgres@127.0.0.1:55432/budgetly_verification_rehearsal',
    workers=4,
    before_cleanup=rehearse_dump_restore,
)
```

The hook runs after every check passes and before engine disposal and schema cleanup.
It is skipped on verification failure. Its return value is ignored; an exception fails
the run while still triggering owned cleanup. It must be called from a fresh process
without earlier API imports. Environment isolation and the socket guard remain active
through the hook; trusted local subprocess tools can reach the validated PostgreSQL.
The parent must independently validate restore targets and track its own resources.
Schema-scoped dumps or whole-database dumps can be taken here, but this harness only
owns and removes its own schema. Dump evidence must not expose URLs or fixture secrets.
