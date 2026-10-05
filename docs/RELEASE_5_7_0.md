# Budgetly 5.7.0

Android versionCode: 42. This is a backward-compatible feature release.

## Added

- Google signup with a preferred-name step and Google sign-in alongside existing authentication methods.
- Explicit account linking, signed-token verification, expiring one-use OAuth flows, cancellation, and identity confirmation.
- Google signup indicator next to the email in the admin user directory.
- Optional Google Drive connection, full JSON backup upload, file listing, download, and disconnect in Backup & restore.
- Encrypted server-side Drive refresh tokens, narrowly scoped file access, and download size limits.
- Additive database migration for Google identity and authorization records. Existing financial records are not rewritten.

## Verification

- Frontend: 123 tests passed across 39 files.
- Backend: 146 tests passed; three dependency deprecation warnings remain.
- Production frontend build and version consistency check passed. A bundle-size warning remains.
- Android Capacitor sync and debug Java compilation passed. No signed APK was produced.
- Mocked-provider browser checks passed at desktop and Android-sized viewports in light and dark themes.
- Existing UI regression checks passed at 320, 390, and 1440 pixels.

## Activation

Follow [Google setup](GOOGLE_SETUP.md) to create the owner's Cloud project, configure separate OAuth clients, and add backend secrets. Google features remain unavailable until configured. Run the live provider acceptance checklist before enabling this for users; mocked tests do not verify production consent or a physical Android device.

Live financial records remain in Budgetly's existing database. Drive backup is opt-in and downloading a backup never automatically restores it. No production deployment or production database migration was performed during this implementation.
