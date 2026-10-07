# Budgetly 5.15.0 verification

Scheduled posting runs on the server. Push delivery uses the existing Firebase
and Web Push setup; it never executes or rolls back a financial entry.

Enable **Scheduled entries recorded** and save notification settings on each
signed-in device after installing this version. Existing devices remain opted
out until explicitly enabled. Only the person who scheduled the entry receives
the alert. The lock-screen message names the entry type, not amounts, wallets or
full descriptions. Failed deliveries retry for up to a day. Provider acceptance
is not a guarantee of display; offline devices and battery controls can delay it.

Shared reference photos are available under the initially collapsed **More
options** section for Record now. Scheduling photos is not supported in either
personal or shared forms. Photo access follows shared-wallet permissions.

Currency search uses supported currency names and codes. Manual entry accepts
supported ISO codes, not arbitrary symbols. Changing currency never converts
existing balances.

## Checks on the phone after building

- Schedule a tiny shared entry in a disposable shared wallet; close Budgetly and
  verify the recorded alert, then disable that alert and repeat with no alert.
- At the Android large-font setting, inspect Settings, currency choices and the
  transaction sheet. Verify keyboard focus stays visible and Back closes the
  keyboard, picker, and sheet in that order without discarding drafts silently.
- Verify biometric login, offline draft persistence and reconnect sync.
- Install the signed update over the existing app and confirm records remain.

Real-device checks require the phone; browser simulation does not verify Android
keyboard, biometric hardware, or system installation behavior.
