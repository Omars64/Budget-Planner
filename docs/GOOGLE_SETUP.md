# Google sign-in and optional Drive backups

Google sign-in does not move Budgetly's live database to Google. Drive access is a separate, optional consent. Email/password and passkeys remain available.

## Cost

Creating the Google Cloud project and standard Google sign-in integration does not require a paid Google Cloud plan. Normal Drive API usage below Google's daily billing threshold incurs no extra API charges; do not assume unlimited free usage at scale. Google documents updated quotas for projects created from May 2026 and potential high-volume charges. Check [current Drive usage limits](https://developers.google.com/workspace/drive/api/guides/limits) before launch and as usage grows. Do not enable unrelated paid services. Backups consume each user's available Google storage. Budgetly's existing hosting usage still applies.

## Google Console

1. Create a project in Google Cloud Console. Configure Google Auth Platform branding and audience, including Budgetly's support email and published privacy policy.
2. Configure the OAuth consent screen for external users. While in Testing, add test users. Google testing-mode refresh tokens can expire after seven days for Drive access; publish the consent configuration for real use.
3. Enable Google Drive API. Request only `openid`, `email`, `profile`, and optional `https://www.googleapis.com/auth/drive.file`. Do not request full Drive access.
4. Create two Web application OAuth clients for the backend-mediated authorization-code flows: one for sign-in and a separate one for Drive backup access. Credentials stay on the backend; never put the client secret or token encryption key in a Vite variable, Android asset, or Git.
5. Add these exact authorized redirect URIs, replacing the domain with your real deployment: `https://YOUR_DOMAIN/api/auth/google/callback` and `https://YOUR_DOMAIN/api/google-drive/callback`. Use a separate HTTPS test deployment and client for integration testing.
6. Set the backend configuration described below, redeploy, and run the live acceptance checks. Until configured, Google authentication remains disabled.

For sensitive-action confirmation, enable Google's authentication-time session metadata in the sign-in client's settings if required by your Console configuration. Budgetly explicitly requests `auth_time` and rejects missing or stale authentication proof. Test this separately from ordinary sign-in: an existing Google browser session is not automatically fresh verification. If Google cannot supply fresh proof, use the email reset flow to set a Budgetly password and confirm with that password instead.

References: [Google OpenID Connect](https://developers.google.com/identity/openid-connect/reference) and [Drive authorization scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).

## Backend environment variables

Set these in Vercel Production (not in the APK or frontend):

```env
GOOGLE_AUTH_ENABLED=true
GOOGLE_CLIENT_ID=YOUR_WEB_CLIENT_ID.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=YOUR_WEB_CLIENT_SECRET
GOOGLE_REDIRECT_URI=https://YOUR_DOMAIN/api/auth/google/callback
GOOGLE_DRIVE_CLIENT_ID=YOUR_SEPARATE_DRIVE_CLIENT_ID.apps.googleusercontent.com
GOOGLE_DRIVE_CLIENT_SECRET=YOUR_SEPARATE_DRIVE_CLIENT_SECRET
GOOGLE_DRIVE_REDIRECT_URI=https://YOUR_DOMAIN/api/google-drive/callback
GOOGLE_DRIVE_ENCRYPTION_KEY=YOUR_FERNET_KEY
```

Use separate clients so Drive access stays independent from sign-in permissions. Register each client's corresponding callback. Generate the Fernet key once with your Python environment using `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`. Treat the resulting key as a secret. Never share it in chat or commit it. Keep your existing strong `APP_SECRET` and production database configuration unchanged.

Android opens Google's authorization page in the system browser using Budgetly's native OAuthBrowser plugin, with the HTTPS backend callback and private polling channel. This implementation does not embed Google login in a WebView or require an Android OAuth client for the backend web-client flow. The user returns to Budgetly after browser authorization. Rebuild the APK to include the plugin.

## Operational safeguards

- Keep the backend OAuth encryption key stable and backed up securely. Rotation needs a re-encryption plan or users must reconnect Drive.
- Disconnect revokes the stored Drive authorization and removes local tokens; it does not delete the user's existing Drive backup files.
- Drive backup files contain financial information. Keep the Budgetly backup folder private; Google storage encryption is not the same as user-controlled end-to-end encryption.
- Restore uses the existing explicit JSON restore process. Downloading a Drive backup never automatically overwrites live records.
- The Google signup indicator is separate from linked login methods. Existing password users remain the same account after explicit Google linking.

## Live acceptance checklist

- Browser and signed Android APK: create a Google account, choose preferred name, sign out, sign in again, verify same workspace.
- Cancel/deny Google consent; account creation must not happen. Try inactive users and expired flows.
- Existing same-email password account: Google login must not silently merge. Sign in normally and link Google from Account security.
- Google-only account: fresh Google identity confirmation must work for sensitive actions. Set a Budgetly password through the email reset flow; verify both methods still work.
- Connect Drive separately, upload a full JSON backup, list and download it, and test restore in a disposable workspace.
- Disconnect, revoke access from Google, exhaust storage, and simulate provider outages; show recoverable messages without losing local data.
- Admin directory: email plus Google icon for Google-created accounts; password-created accounts remain correctly identified.

Google Console credentials and real provider consent require the owner's setup. Mocked provider tests cannot establish that the production OAuth consent screen or APK is configured correctly.
