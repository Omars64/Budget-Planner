# Reliability work — 28 October 2026

## Live findings before changes

The production v6.5.3 Admin page reported healthy daily recovery and scheduled
entries, but independent backup was not configured. The approved Backblaze bucket
`budgetly-recovery-omars64-20261012` was private, encrypted, and empty. No
`BACKUP_` variables existed in the Vercel project. A bucket alone is not a backup.
These observations are a point-in-time check, not a continuing availability claim.

## Changes

- Encrypted run manifests now bind archive size and SHA-256 digest. The read-only
  `--run` verifier checks every archive in a completed run without exporting records.
  Legacy manifests still work. Missing, corrupted and cross-run files cannot pass.
  Uploads also read back every object and compare encrypted bytes before reporting
  success. Storage connection/read timeouts and retries are bounded.
- An isolated synthetic round trip connects real account export, encrypted object
  upload/download and fresh-account restore, checking balances, Space membership,
  receipts, attachments and an unaffected source account.
- Admin shows missing backup configuration, upload totals and honest database-only
  recovery wording. Failed refreshes mark the previous health view unconfirmed.
- Truncated successful responses are no longer interpreted as confirmed saves.
  In-flight failures cannot queue under a newly signed-in account.
- Local queue read failures remain visible; pending entries have retry/review
  controls, without adding success toasts for routine background synchronization.
- Job freshness rejects future timestamps and uses newest-ID tie breaking.
  Monitoring retries transport errors. Public readiness labels cached and uncached
  paths without adding database probes or exposing operational credentials.
- Critical journey tests use real synthetic login and confirmation, Space roles,
  revocation, scheduled-posting retries and repeated restoration.

## Completion boundaries

The owner entered both storage credentials and the encryption key as Vercel
Production Secrets; bucket, region and endpoint are Production Config variables.
No secret value was copied into source or chat. Backblaze displayed $0 daily
storage/download caps and alert recipients enabled. The owner chose to keep all
backup copies; the proposed 30-day lifecycle rule was cancelled without applying.
At the free capacity limit, uploads can stop; retained files are not silently
deleted to make space. Protect the encryption key outside the hosting account.

Production verification completed on 28 October 2026: v6.5.4 uploaded encrypted
archives for all ten then-active accounts and read every object back before
recording success. A downloaded real archive subsequently passed isolated
restoration with matching balances, memberships and attachment content after
the legacy-category compatibility fix in v6.5.5. See RECOVERY_COMPATIBILITY_655.md.
The owner confirmed a protected encryption-key copy outside Vercel. A fresh
v6.5.5 backup reported healthy at 16:00 Kuwait. These are point-in-time checks;
no production restore or replacement of user financial records was performed.

## Local evidence

- Complete API suite: 885 passed, 22 environment-specific skips. The later
  read-back integrity addition passed 37 focused backup/recovery tests.
- Final targeted frontend suite: 50 passed, including account switches, offline
  retry UI, recovery status, idle polling and motion preference behavior.
- Browser sign-in and database-only recovery succeeded against a synthetic-only
  loopback database. The warning and confirmation correctly disclosed that this
  was not independent backup. Android-width DOM measurements found no overflow.
- Lint had zero errors and six existing React-refresh warnings; production web
  build passed. Final release gates must still run against the settled tree.

Neon consumption needs observation over a complete quota period; this cannot be
proven in a single session. Pausing idle client reads does not reset an exhausted
quota and does not prevent legitimate users or scheduled jobs waking the database.
Free quotas provide no guarantee of uninterrupted service. No paid upgrade is
part of this release.
