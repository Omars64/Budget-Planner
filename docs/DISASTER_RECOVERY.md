# Budgetly backup and restore

Budgetly has three separate recovery tools:

1. **Full JSON backup in Settings**: an account owner downloads a restorable copy of their owned workspace. Restore requires a recent password confirmation and replaces that workspace. A recovery copy is captured before replacement.
2. **Daily recovery copies**: the maintenance job stores short-term copies in the live database. They help with an accidental change, but do not protect against losing the database itself.
3. **External encrypted backups**: when configured, the daily job uploads one encrypted JSON backup per active account to a private S3-compatible bucket. Shared-wallet members do not receive the owner's full workspace backup. Owners' copies include their shared-wallet records.

Statement exports in CSV, XLSX, PDF, and Word are for reading or copying records. They are not restorable backups.

External runs use an immutable `budgetly/YYYY-MM-DD/RUN-ID/` prefix and store
an encrypted `manifest.json.gz.enc` there only after every account upload succeeds.
An interrupted run cannot overwrite an earlier complete run. Older day-only
archive keys remain readable; do not delete them during an upgrade.
It maps account IDs, email, display name and role to the day's archives, but
contains no passwords, sessions or Google login credentials. Verify it using
the same external-backup verifier. This is an operator recovery index, NOT a
workspace import file. Rebuilding accounts requires verified identity and fresh
authentication before assigning records; do not restore someone else's archive
merely because its filename contains a familiar ID. Daily external copies have
a worst-case recovery-point gap of approximately 24 hours when jobs succeed.
Provider snapshots/history complement them; they do not make that gap zero.

## Configure external backups

Set these server-only Production variables in Vercel:

```text
BACKUP_S3_BUCKET
BACKUP_S3_REGION
BACKUP_S3_ACCESS_KEY_ID
BACKUP_S3_SECRET_ACCESS_KEY
BACKUP_ENCRYPTION_KEY
```

Use `BACKUP_S3_ENDPOINT_URL` only for a compatible non-AWS provider. Generate a Fernet key locally with `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` and store it securely outside Vercel too. Losing that key makes stored backups unreadable. Never put it in Git or a mobile build.

Use a private bucket with public access blocked, bucket versioning, and an IAM principal limited to the `budgetly/` prefix. Configure bucket lifecycle retention for daily objects (at least 14 days, or longer if required). The app does not create separate weekly or monthly copies; arrange those with the storage provider if needed. S3 storage and requests can incur charges. Provider-level PostgreSQL backups or point-in-time recovery should also be enabled; the application cannot turn those on without access to the database provider.

The `/api/maintenance/daily` Vercel cron uses `CRON_SECRET`. In Admin > Service health, `External backup` must show a recent successful time after the first run. `Configured, not run yet` is not proof of a usable backup. A failed upload records an error and returns HTTP 503; investigate Vercel logs and the bucket before relying on it.

## Verify and restore

Once a month, use a backup from the previous day:

1. Run `python scripts/verify_external_backup.py --key budgetly/YYYY-MM-DD/RUN-ID/user-ID.json.gz.enc --output isolated-test-backup.json` on a secure machine with the backup environment variables available. The script decrypts, decompresses, checks the format, and reports record counts without printing transaction content. Choose a run that contains its completed manifest.
2. Create a separate test deployment and empty test database. Do not point a restore test at production.
3. Sign in to a test account. In Settings > Backup & restore, restore `isolated-test-backup.json` after confirming the password. Check wallet count, transaction count, shared-wallet ownership, balances, and Overview totals against the backup.
4. Record the date, object key, counts, duration, and result. Remove the temporary plaintext JSON securely after verification.

For a live incident, first stop writes or put the app into maintenance, preserve the latest database snapshot, and identify the affected account and restore point. Prefer a managed PostgreSQL restore into a new database when many accounts are affected. For one account, decrypt its external object and restore the JSON through Settings with that account's authorization. Confirm record counts and balances before reopening access. Never merge a statement export into production as if it were a full backup.
