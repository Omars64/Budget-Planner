# Budgetly Android distribution and Play Protect review

Budgetly is distributed as a signed APK from the project's GitHub release. Play Protect still scans it. Do not ask users to disable Play Protect or hide the APK from scanning.

## Declared capabilities

- Notification access: optional Smart Bank Inbox. The user selects bank apps and grants Android notification access. The listener checks the selected package list, drops security-code messages before storage, and can be disabled in Settings.
- Install packages: used only when the user taps the in-app update button after the APK has been downloaded from the official release and checked against its published SHA-256 digest and signing identity.
- Microphone: optional voice input, requested when used.
- Notifications: update and reminder alerts selected by the user.

## Warning-specific response

1. Capture the **exact warning text**, installed APK version and Android version. The warning may concern an unknown app, sensitive permissions, or an identified harmful app; these require different responses.
2. Confirm the APK is the official GitHub release asset, that its SHA-256 matches `update.json`, and that the signing certificate is the same as the previous Budgetly release. Do not redistribute a re-signed APK.
3. For an unknown-app scan, allow Google to complete the scan. For a sensitive-permissions or harmful-app warning, review the current manifest and native code, then submit the APK through Google's Play Protect developer appeal/review path. Include the privacy policy and a concise explanation of the permissions above.
4. If Google reports a specific behavior, repair that behavior, issue a new APK with the same signing identity, and request review again. Only Google can clear its verdict.

Official guidance: https://developers.google.com/android/play-protect/warning-dev-guidance and https://support.google.com/googleplay/android-developer/answer/2992033
