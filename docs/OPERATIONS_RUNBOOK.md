# Budgetly operations runbook

## Daily checks

- Open `/api/health`; production must return `database: postgresql` and `persistent_storage: true`.
- In Admin > Service health, check database, email configuration, daily recovery time, external backup time, and recent 5xx or slow requests. A backup is healthy only after a successful run.
- Check Vercel runtime logs for repeated `request path=`, `Database initialization failed`, `External backup failed`, SMTP errors, and AI provider errors. Check the database provider dashboard for storage, connections, and automated backup status.

## Before a release

1. Verify production environment variables in Vercel. Required: a managed PostgreSQL URL, a strong `APP_SECRET`, and `CRON_SECRET` for maintenance. Add SMTP and OpenAI variables only for those enabled features. External backup needs the five variables listed in [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md).
2. Confirm an external backup or provider snapshot exists. Keep the prior deployment available for rollback.
3. Run `npm run release:check`, `python -m pytest tests -q`, and `npm run android:sync`; build a signed APK separately when releasing Android.
4. Review new Alembic revisions. New databases are created through the baseline migration. Existing installations are checked and stamped automatically without replacing rows. Future schema changes require a new revision and a rehearsal against a restored test database.
5. Deploy to Preview, check sign-in and a test transaction, then promote. Check `/api/health`, an owner statement export, and an Android API connection after release.

## Incidents

- **Database unavailable:** check Vercel connection variables and database provider status. The app returns 503 if startup migration or storage initialization fails. Do not enable SQLite on Vercel.
- **Email failing:** open `/api/health/email?probe=true` as an admin, then inspect SMTP credentials and Vercel logs.
- **External backup failing:** check `BACKUP_S3_*` permissions, bucket region, encryption key format, bucket capacity, and recent `external-backup` events. Do not label same-database recovery copies as independent backups.
- **AI failing or costly:** disable Ask Budgetly in Admin; check OpenAI project usage and limits. Existing built-in guidance remains available.
- **Bad deployment:** promote the prior known-good Vercel deployment. Database migrations may not be reversible by code rollback; restore or apply a tested corrective migration if the schema changed.
- **Android API failing:** check the production URL, `/api/health`, device connectivity, and the configured backend URL in `src/lib/api.js`.

Account activity and shared-wallet activity record actor, action, resource, and time. Do not put passwords, tokens, or financial details in operational logs. Review rate-limit 429s as a signal of abuse or an over-tight limit.
