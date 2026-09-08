# Android bank app compatibility investigation

## Evidence and limits (8 September 2026)

The reported symptom is bank apps refusing to open after FlowBudget enrollment,
then working after the installed browser shortcut was removed. The bank warning,
Android/browser version and installed package identity have not been supplied.
This is a correlation, not a confirmed biometric defect or a reproduced bank verdict.

The deployed website uses browser WebAuthn. It does not contain a web app manifest,
service worker, accessibility service, overlay, screen recording, SMS inbox reader,
or notification listener. WebAuthn creates a site-bound credential; it does not
enroll a new fingerprint in Android settings or expose biometric data to FlowBudget.
Browser shortcuts and WebAPKs are different from the separate Capacitor APK.

Google documents app-access risk signals for installed apps, capture, device
control and overlays. A bank may use these signals or its own checks. No evidence
yet identifies which check fired on the reported phone. Website code cannot change
the bank's policy or the permissions of an already installed native package.

## Changes

- Password-only preference in sign-in and Settings disables both enrollment and
  passkey login for this browser, persists through logout, and leaves account keys intact.
- Passkeys require a secure top-level, initially visible page and an explicit user action.
  Only one request can run; page exit, component removal and a two-minute deadline
  cancel pending operations. No authentication starts on app focus or in the background.
- Authentication is not cancelled merely on blur: the operating-system credential
  chooser can legitimately take focus during enrollment.
- Hosting headers deny framing, screen capture, camera, microphone, location,
  hardware-device APIs and WebOTP. First-party WebAuthn remains permitted.
- The native source no longer requests RECEIVE_SMS or registers an SMS receiver.
  Its retained plugin only reads/acknowledges previously queued messages; it cannot
  enable capture or request SMS permission. No stored bank transactions are deleted.

The website deployment updates browser clients. Existing APKs need a rebuilt,
signed update; a Vercel deployment cannot replace AndroidManifest.xml on a phone.
Native SMS source removal has structural tests, not physical-device certification.

## Retest on the affected phone

1. Open the production URL directly in the current browser and refresh. Sign in
   with a password and enable "Use password only on this device".
2. Leave FlowBudget and open the affected bank app. Record the exact warning if it
   fails. Do not disable the bank's protection or Google Play Protect.
3. If it works, test the original browser shortcut separately while password-only
   remains enabled. If only installation triggers the warning, report the browser,
   phone/Android version and installed package shown in Android App info to the bank.
4. Only after those checks pass, turn password-only off and test one passkey
   enrollment. Switch back to the bank after the system dialog has closed.
5. If only passkeys trigger it, record which system credential provider was selected
   and whether Android requested a change to the screen lock or fingerprints. Those
   system changes can affect bank enrollment independently of FlowBudget.

Until this device test passes, describe the release as a compatibility mitigation,
not a guarantee that every bank will accept the installed shortcut.

## Primary sources

- https://developer.android.com/google/play/integrity/verdicts
- https://developers.google.com/identity/passkeys
- https://developer.chrome.com/docs/android/trusted-web-activity
- https://www.w3.org/TR/webauthn/#sctn-aborting-authentication-operations
