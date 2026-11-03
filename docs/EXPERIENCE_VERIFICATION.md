# Budgetly experience verification

This checklist uses a disposable account and synthetic entries. Never use a production account or copy a customer's financial records into test evidence.

## Release evidence

- Browser reliability CI exercises sign-in, saving, offline reconnect, replay protection and account isolation. It now checks Transactions, Upcoming and Settings at 1440, 390 and 320 CSS pixels for horizontal page overflow.
- `browser-layout-evidence.json` records navigation duration and horizontal overflow for each synthetic route. Compare the same CI environment across releases; investigate regressions before setting an enforced performance budget. This is not a midrange Android cold-start measurement.
- Android QA: open a clean installation and an upgrade over the previous APK; record time to a usable Overview on a midrange device. Repeat with a long transaction history and a throttled connection. Record device model, Android version, theme, font scale and timings. A measured baseline is required before setting a numeric gate.
- Inspect focus and labels with a keyboard and Android screen reader. Repeat at 200% text and with reduced motion. Check light, dark and seasonal appearances. Buttons and amounts must remain visible without horizontal page scrolling.

## Three unassisted user tasks

Invite at least three people who did not design the feature. Ask them to think aloud, but do not guide them. Record where they pause, tap the wrong control or cannot tell whether a save succeeded. Do not record their financial data.

1. Record an expense in a named wallet. Confirm the transaction appears and the save state is clear.
2. Correct the amount of that entry. Confirm the new amount and wallet balance match, then remove the synthetic entry.
3. Review a synthetic bank alert, choose the intended Personal or Space wallet, approve it and locate the recorded entry.

Record task completion, time, missteps and the user's own explanation of the result. A release is not considered user validated until participants complete these tasks; automation is a separate check.

## Operations review

- Inspect Admin → Service health for failed financial saves, slow requests and last checked time. These are observed events, not proof of a particular lost record.
- Check scheduler and external-backup heartbeat. Verify the current encrypted archive in an isolated recovery environment before claiming recovery is proven.
- Check provider usage and alert delivery separately. No synthetic example in the POC is production telemetry.
