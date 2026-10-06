# Daily-use improvements

Version 5.13.0 builds on existing entry memory, statement import, weekly summary,
search filters and restore confirmation. No paid AI extraction is enabled.

## Workflows

- Entry: choose a remembered description to prepare a wallet/category draft.
  Archived/missing choices are not applied, edits are not overwritten, and Save is
  still required. Personal preferences can disable memory and suggestions.
- Receipts: open a personal transaction's details, expand Receipt, take or choose
  a photo, review, then Save receipt. Photos are compressed and validated on the
  server. They are private to the record owner, included in JSON/Drive backups,
  remapped on restore, and preserved when the transaction is moved to Trash.
  Receipt uploads require a connection; failed uploads keep the photo for retry.
  Guest and shared-wallet receipt handling is not enabled in this release.
- Statement matching: possible matches have the same wallet, type and amount,
  within three days. Similar rows are unchecked until reviewed. A confirmed match
  keeps the existing transaction, without modifying it or adding a second record.
  Exact duplicates and repeated CSV rows are flagged. The server rechecks matches.
- Weekly review: Last 7 days compares spending and links to the largest category;
  personal planned expenses due in the next seven days link to Upcoming.
- Search: Find transactions supports this month/last month, income/expenses/
  transfers and unambiguous exact category names. Other words remain literal text.
  Review the resulting filters before applying. Up to ten named searches per
  account/scope are stored on this device, not synchronized to another device.
- Recovery: preview counts and confirm replacement before restoring. This is
  replacement, not a merge. Latest Drive backup date is shown when connected.

## Required physical Android checks

Automated browser checks do not replace these WebView/device checks:

1. Open a transaction, type with the keyboard visible, move between fields, and
   confirm suggestions do not cover the keyboard or capture unrelated taps.
2. Repeat with the phone's largest practical font/display size. Scroll the form
   and ensure all actions remain reachable without horizontal scrolling.
3. Use Back/Escape on an edited form and an unsaved receipt; keep editing or
   explicitly discard. No record should save merely by dismissing a sheet.
4. Disconnect internet, save a new transaction, reconnect, and verify exactly one
   record syncs. Failed receipt uploads and edits must remain retryable, not appear
   falsely saved. Check another account cannot see the first account's drafts.
5. Interrupt an APK download and retry. Verify the released APK's checksum and
   signing identity remain enforced. Install over the existing app without
   uninstalling, then verify records and notifications persist.
6. Export a receipt backup and restore only into an isolated test workspace.
   Verify totals, attachments, completed schedules and restored receipt links.

Publish only through the existing build batch after regression checks. Never add
credentials or financial backup files to Git.
