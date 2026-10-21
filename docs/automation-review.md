# Automation Review

## Implemented in 6.3.0

- Monthly budget repetition is an explicit switch. Existing month-specific budgets stay unchanged until edited. Repeating budgets reuse the same ID and calculate the selected month's spending from the ledger; there is no destructive monthly reset.
- Upcoming expenses use device notification preferences: calendar days plus a Kuwait-time clock, or a lead duration in minutes. The subject and due time appear in the alert, without amounts or wallet names.
- Android continues to use local scheduled notifications. Browser Web Push for Upcoming is processed by the existing protected scheduled-transactions job. The device preference is encrypted with the existing push subscription. No new secret or scheduler account is required.
- Browser deliveries have per-device, per-due-occurrence receipts. Delivery failures are retried while timely; posted, deleted, disabled, inaccessible and overdue plans are excluded. A due-date edit creates a new occurrence. A retry after a provider accepted a message but before a database commit can repeat delivery; the notification tag replaces the previous notification for that occurrence.
- The operational receipts table is additive. It contains no transaction content and does not change the ledger, budgets, backup data, or existing shares.

After deploying both frontend and backend, save Notifications once on each opted-in device/browser to register the new preferences. Browser background delivery depends on browser/OS support and permissions; Android alarm delivery can be delayed by battery restrictions. Local Android plans and settings synchronize when the app opens or changes are made on that device. Changes made from another device require reopening Android to refresh its local alarms. This release does not claim remote Android alarm synchronization.

## Existing Automation

- Recorded transactions already support daily, weekly, monthly and yearly recurrence. Their occurrence materialization currently runs during app/API use.
- Auto-record Upcoming entries are posted by the server scheduler, with duplicate protection.
- Bank notifications are captured from selected Android apps, but ledger approval is intentionally manual.
- Planner bills already model recurring obligations for forecasts and reminders. They are not automatic bank payments.
- Operational recovery snapshots, update dispatch, and permission-removal retries already have background jobs.
- Transaction entry already offers suggestions based on previous records; the user confirms before saving.

## Awaiting User Approval

| Area | Repetitive work | Optional enhancement |
| --- | --- | --- |
| Recurring ledger entries | Opening the app to materialize repeated recorded entries | Run existing recurrence processing in the protected scheduler, with duplicate and permission tests. |
| Upcoming | Recreating a plan after each cycle | Repeat rules, end dates, pause/resume and skip-one-occurrence controls for personal and Space plans. |
| Planner bills/subscriptions | Recreating planned entries and linking payments | Generate an upcoming occurrence from an opted-in bill, and propose payment matches for approval. |
| Goals/debts | Reentering regular contributions or repayments | Opt-in recurring ledger rules with pause and insufficient-balance behavior; never move real bank funds. |
| Bank Inbox | Selecting the same category, description and wallet repeatedly | User-approved reusable matching rules. Keep review on by default and make any auto-approval a separate explicit decision. |
| Google Drive backup | Clicking Back up now | An opt-in backup cadence with retention limits, failures and last-success status. Operational recovery snapshots are separate. |
| Statements | Re-selecting dates and exporting every month | Saved statement presets and an optional scheduled export. Delivery channel/privacy needs approval. |
| Review/Analytics | Opening and comparing the same weekly/monthly periods | An opt-in summary of changes and upcoming payments. No additional notifications without opting in. |
| Budgets | Choosing what to do with unused or exceeded limits | Optional carryover, separate from the new reset-to-the-same-limit monthly rule. |

Do not enable these proposed automations without approval. Changes to financial records must be visible, reversible where possible, permission-scoped and idempotent. These are Budgetly ledger operations, not instructions to debit a bank account.
