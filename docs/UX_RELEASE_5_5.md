# Budgetly 5.5.0 UX Checklist

Android version code: 40. This release keeps the financial model, permissions,
database records, backup formats and existing signing identity unchanged.

## The 12 Improvements

1. Android focus: full-width header and wallet cards retained; navigation,
   transaction floating button and footer disappear while the text keyboard is
   open. Existing keyboard-aware dialogs and sticky transaction actions remain.
2. Faster entry: account-scoped wallet/category defaults, recent descriptions,
   safe personal/shared duplication and existing templates. Amounts, dates,
   reporting months and recurrence are not remembered by entry history.
3. Shorter Overview: current balance and money in/out remain prominent;
   attention count is linked directly; spending detail is collapsed initially.
   No Add transaction button is added to Overview.
4. Consistent controls: reuse existing DateTimeField, searchable selectors,
   dialogs, confirmation and loading states rather than introducing another set.
5. Save/sync clarity: distinguish syncing, pending entries and failed entries;
   link directly to saved entries for review/retry. Notes autosave status retained.
6. Recoverability: retain transaction Trash/Undo and durable drafts; protect
   transaction, wallet and budget edits on dismissal; add Undo to note moves.
   A note move can only be undone while that same note and destination remain
   selected, preventing an unrelated note from being changed.
7. Shared context: attribution and ownership retained; record details explain
   view/add/edit access. Duplicate is offered only with add access, while edits
   still require edit access. Server authorization is unchanged.
8. Restrained motion: existing motion preferences retained; reduced-motion
   styles also suppress transitions and smooth scrolling.
9. Accessibility: visible focus, mobile touch targets, readable summary amounts,
   wrapping labels and narrow-screen single-column summaries.
10. Recovery actions: personal empty results offer Clear filters/Add transaction;
    existing API retry, offline pending retry and Notes retry retain entered data.
11. Personalization: favorite wallet order, secondary page order by group,
    remembered Notes grid/list view and an entry-memory opt-out/clear control.
    These preferences are isolated per account on the current device.
12. Repeatable QA: regression tests and scripts/verify-workspace-ux.cjs cover
    desktop/phone sizes, themes, reduced motion, larger text, horizontal overflow
    and draft recovery. Existing offline tests cover lost responses, rejected
    shared writes and duplicate-safe retries.

## Release Checks

Run `npm run version:check`, `npm run lint`, `npm test -- --maxWorkers=2`,
`py -m pytest tests -q` and `npm run android:apk -- -Release`.

Browser verification must use an isolated temporary database, not production.
The verification script expects the local preview admin password supplied by
the preview environment and must never be run against the live deployment.

Before distribution, also check a physical Android device: actual keyboard,
system font scaling, Back gesture, biometric login, notification permission,
offline create/reconnect and installation over the previous signed APK.
Browser Android emulation is useful but is not a substitute for those checks.
