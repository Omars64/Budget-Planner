# Admin scheduler controls

`GET/PUT /api/admin/resource-policy` remains administrator-only and revision-CAS protected.
The policy adds `scheduler_enabled` (strict boolean, default true) and
`scheduler_interval_minutes` (strict integer 1..60, default 1). Existing three-field
stored policies receive defaults on read without a migration. Legacy PUTs omit
these fields; Redis merges omissions against the current policy inside the same
CAS operation, preserving pause and interval. Nulls and unknown fields are rejected.

External cron continues every minute. A single atomic Redis claim checks the
owned lease, pause, and minimum start-to-start interval before due markers or
pending writers. Paused/interval claims return HTTP 200 with `skipped: true` and
`reason: paused|interval` before database initialization/dependencies. Coordination
outages on a configured scheduler return 503 before database access. Busy claims
remain successful skips. Due work, new plans, failures, and the reset drain cannot
shorten the selected interval. Idle markers can postpone a run further.

Pause prevents new automatic scheduled-entry/reminder runs. An already claimed
run may finish and commit; pause never cancels a transaction. With coordination
configured, auth/planned GETs and daily maintenance no longer post due entries;
only the claimed cron context can do so. Manual transactions, plan edits, daily
backups, and update notifications remain available. Unconfigured installations
retain the existing automatic behavior and cannot persist admin controls.

Pending tokens remain permanent until their own writer confirms completion.
Policy updates invalidate generation without deleting leases or pending writers;
a stale finish cannot publish idle state. Interval skips never publish an idle
marker or clear pending tokens. Scheduler job status exposes `paused` and
`interval_minutes`; intentional pause suppresses scheduler failure/overdue health
vetoes, while database readiness and coordination health remain independent.
Enabled overdue detection allows the selected interval plus five minutes.

No database migration, record rewrite, billing, credential, or production changes.
