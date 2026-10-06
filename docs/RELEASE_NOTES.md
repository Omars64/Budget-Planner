# Update popups

Android shows a centered update popup with published version-specific notes, verified download progress, retry, and the Android installer flow. A dismissed popup can be reopened from Settings. Automatic update notices follow the update-notification preference.

Android and browser show What's new after sign-in on the installed version. Dismissal is remembered per account on this device; notes can be reopened from Settings. Guests are not shown the automatic post-login popup. Browser users do not receive the Android download popup.

Before each release, add the new version's concise title/detail entries to `release-notes.json`. Describe only changes included in that release. The release-manifest script requires matching notes and attaches them to `update.json`. Untrusted or oversized note fields are filtered; notes render as plain text, never HTML.

The 24px-corner popup uses a 1.1-second upward entrance and respects system and Budgetly reduced/off motion preferences. On short screens the notes scroll within the popup while the full-width footer remains available.

Devices running older Budgetly versions retain their old update presentation until they install this release. The browser receives the new UI after deployment and refresh.
