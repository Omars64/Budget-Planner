# Production hardening evidence

Date: 12 October 2026. Production records must not be edited for verification.

## Managed recovery

The owner approved restoration into a separate Neon branch. A manual snapshot
of the production `main` branch at 02:59:57 UTC (05:59:57 Asia/Kuwait) was
restored using Multi-step restore. The console explicitly left main unchanged.
The new branch was not connected to Vercel or promoted to default.

Read-only SQL used a repeatable-read transaction and ended with ROLLBACK.
Only aggregate results were inspected: 10 accounts, 13 wallets, 312 transactions,
3 Spaces, and zero receipt rows at the snapshot point. All orphan-transaction,
orphan-receipt, Space-owner mismatch and invalid-amount counts were zero.
The schema revision was `f43c912ab706`. No personal descriptions, emails,
amounts, passwords, tokens or keys were printed or exported.

The project is Free, PostgreSQL 18, with a six-hour history window. The safety
snapshot was preserved. The recovered branch is `br-broad-wildflower-auqurv3x`;
production remains `br-odd-cloud-aufh2z9x`. These are non-secret resource IDs.

This proves a real provider snapshot can be restored and queried coherently.
It does not prove independent-provider recovery, all-table byte equality,
key escrow, full application restart on a recovered deployment, or an outage SLA.
Independent storage was not configured in Vercel at inspection time.

## Isolated load

See LOAD_VERIFICATION.md for 20 synthetic accounts, six months of history,
20,060 initial records and 16/32-worker request mixes. Real user data and live
API endpoints were never load-tested. A post-change 32-worker run exposed pool
starvation and was retained in the evidence. After removing unnecessary read
claims and isolating diagnostic writes from the request pool, the rerun passed
807 requests with zero request errors, reconciled balances and receipts,
26.124 requests/second and 2047.846 ms p95 over 30.891 seconds. This is local
small-application evidence, not a production scale or uptime guarantee.

## Safety constraints

- No production restore, record cleanup, schema rewrite or billing upgrade.
- All race/load mutations use owned schemas on disposable loopback PostgreSQL.
- Uploading encrypted user backups requires explicit destination approval.
- Backup keys must be stored outside Git and escrowed separately from Vercel.
- A rating is an evidence-based judgment, not a security or uptime certification.
