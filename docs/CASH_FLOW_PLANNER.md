# Cash-Flow Planner

Planner forecasts personal-wallet cash without changing the ledger. It lives in Planning, with a compact Overview estimate. Guest mode remains limited to its existing supported pages.

## Calculation Rules

- Current cash includes active personal-wallet opening funds and recorded movements up to the current Kuwait time. Shared and archived wallets are excluded.
- Recorded future transactions and scheduled Upcoming entries are distinguished from assumed bills, planned Upcoming entries, and recurring ledger occurrences.
- Cash dates drive the forecast, not the income/expense reporting month.
- Available to spend is current cash minus goal money set aside, the safety buffer, and negative movements before the next known income (or the selected horizon). Future income is never spendable cash today.
- The 30/60/90-day chart uses daily closing balances. Shortfall checks also examine movements within each day, against reserves and the buffer. A same-time expense is evaluated before income.
- Estimates include only entered items, not unknown everyday spending. They are not guarantees or financial advice.

## Bills and Subscriptions

Up to 100 bills can be saved with personal wallet, amount, due time, weekly/monthly/yearly/one-time recurrence, reminders, and pause state. Monthly/yearly bills retain their original day through short months and leap years. Missed, unpaid cycles are included today rather than silently discarded.

Price changes retain up to 12 previous prices. Link a matching Upcoming expense to avoid counting the first occurrence twice. For recurring ledger expenses, use either the ledger recurrence or a Planner bill, not both.

Record payments in Transactions, then link an existing expense to a bill cycle. Linking does not create a transaction. A payment cannot be used for two cycles. If that expense is deleted, the cycle becomes unpaid again. Changing a bill's due date, recurrence, or wallet starts a new schedule and clears its payment links; ledger entries remain unchanged.

## Reminders, AI, and Storage

Bills reuse the device's Upcoming-expense reminder permission, lead time, and clock time. Android schedules the next 60 eligible reminders across Upcoming and Bills together, earliest first, refreshed on app activity. Browser bill reminders require Budgetly to be open. This does not add a closed-browser bill push scheduler.

Explain my forecast opens Ask Budgetly with a question for review. The existing paid provider, consent, quotas, and built-in fallback apply. AI receives calculated facts, labels assumptions, and cannot silently change financial records. What-if purchases only call a read-only preview endpoint.

Planner settings use per-user AppSetting storage, revision-checked writes, and the existing account-deletion lifecycle. JSON/Drive backups retain bill history and payment links; restore validates and remaps wallet, transaction, and Upcoming IDs before replacing data. No database schema change or new paid service is needed.
