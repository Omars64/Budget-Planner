# Independent scheduled posting

The daily Vercel job and opening Budgetly already process overdue scheduled entries.
For minute-level closed-app posting, configure an independent scheduler:

- Set a strong `SCHEDULE_RUNNER_SECRET` in Vercel Production.
- Call `POST https://budget-planner-ecru-seven.vercel.app/api/maintenance/scheduled-transactions` every minute.
- Send `Authorization: Bearer <SCHEDULE_RUNNER_SECRET>` in a header, never in the URL.
- Use HTTPS; do not put credentials in Git, screenshots, or release artifacts.
- Deploy the endpoint before activating the scheduler. Verify unauthorized calls fail.

Only entries explicitly marked Scheduled are posted. Planned entries remain drafts.
Shared wallet permissions are rechecked at execution. PostgreSQL row locks prevent
duplicate posting from concurrent runners. Overdue entries catch up after outages;
record dates retain their scheduled time. Each invocation processes at most 1,000
entries, including failed plans. This is not an exact-second guarantee.

Keep the daily backup job unchanged. Notifications are not responsible for posting.
Unsynced offline drafts must reach the server before they can execute while closed.
Recurring recorded entries use a separate materialization path and are not included
in this scheduler endpoint.
