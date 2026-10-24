# Free-tier resource coordination

Financial records, account permissions, receipts and recovery records remain in
the existing Neon database. This release does not migrate or delete them.
Upstash holds only opaque coordination tokens, operational timestamps/counters,
and three administrator-selected resource intervals. Credentials are server-only.

## Defaults and behavior

- Active client refresh: 60 seconds (15–300); hidden/offline clients pause reads.
- Idle scheduler recovery rescan: 180 minutes (15–1440).
- Database readiness probe: 60 minutes (15–1440).
- The external scheduler still calls every minute. An authenticated check skips
  database initialization when a durable next-work marker says no work is due.
  Actual scheduled-entry and reminder deadlines override the idle interval.
- New/reset coordination state processes normally for a ten-minute safety
  window before allowing idle skips. This drains requests from retired workers;
  scheduled work continues throughout. Production requests are capped at 300s.
- Saves invalidate the idle marker before database work. Concurrent scheduler
  runs use an owned lease and generation fence; existing database idempotency and
  financial locks are unchanged. Daily recovery and any separately configured
  encrypted external-backup jobs retain their existing behavior. This release
  does not provision an independent backup destination.
- Public readiness can be cached. Its probe timestamp is not a live per-request
  database query. Stale/failed scheduler checks veto a healthy cached result.
  Liveness `/api/health/live` deliberately does not assert database availability.

Longer refresh/probe intervals delay cross-device updates/availability detection.
Explicit user saves and refreshes are not rate-limited by these intervals. These
settings cannot enforce a total database quota. Sustained real traffic may still
exceed a free plan; this work does not reset already-consumed Neon allowance.
Watch actual usage in both provider dashboards; no paid upgrade is enabled.

## Configuration

Production-only `KV_REST_API_URL` and `KV_REST_API_TOKEN` are provided by Vercel's
Upstash connection. `UPSTASH_REDIS_REST_URL/TOKEN` is also supported. Do not expose
tokens through VITE variables. Development/Preview are disabled unless an explicit
`BUDGETLY_COORDINATION_NAMESPACE` is supplied for an isolated synthetic test store.
Environment, application secret and database host also isolate coordination keys.

## Failure and recovery

If Upstash cannot confirm a pre-write marker, the request returns 503 **before**
database dispatch. Supported transaction requests retain their existing offline
queue behavior. Other forms show an error and must be retried; they are not all
offline-capable. Pure read routes and scheduler processing fall back to the
original database path. Some financial GET routes materialize recurring entries;
these, OAuth callbacks and cold database bootstrap also require a confirmed
guard. Never interpret a failed save as an accepted transaction.

An interrupted writer can leave a persistent pending marker. It intentionally has
no expiry: guessing when a financial request finished could hide its schedule.
Pending markers prevent idle skipping, not financial processing. Admin displays
the count; investigate runtime logs and in-flight work before recovery. There is
no automatic or public marker-clear endpoint.

Emergency rollback: set `BUDGETLY_RESOURCE_OPTIMIZATION=0` in Vercel Production and
redeploy. This restores legacy database polling and removes the Upstash dependency
for writes without changing records or connection strings. It increases Neon use.
Do not delete coordination keys while optimized workers are running. After
provider recovery, redeploy with optimization enabled and verify scheduler runs,
pending count, readiness, backups and skip counters before assuming savings.

Health checks and leases use UTC epochs; ledger deadlines retain the existing
Kuwait-time semantics. Scheduler failures retry within a minute. Missing/corrupt
coordination markers cause processing, never silent skipping. Backup failures and
overdue entries remain unhealthy signals.
