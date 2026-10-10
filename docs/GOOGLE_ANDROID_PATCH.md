# Google sign-in and deletion: 5.8.1

Android sign-in now waits for the app to be visible before collecting the result and retries temporary network/service failures without restarting consent. Cancellation and expired/invalid states still fail closed. The preferred-name step explicitly tells users to enter their name and tap Create Google account.

Google credentials needed for revocation are encrypted on the server using a domain-separated key derived from the existing APP_SECRET. Keep APP_SECRET stable and protected. Credentials never enter app responses or workspace backups. A new additive migration creates google_revocation_credentials; no financial tables or existing transaction records are changed.

Both user and administrator deletion revoke Google sign-in and connected Drive credentials before deleting local records. Provider/network failures stop deletion rather than silently leaving permission active. Previously linked users without retained credentials must authenticate with Google again before deletion, including Google account confirmation in Settings. Administrators may need to ask the user to do this first. Removing an app connection manually is available at https://myaccount.google.com/connections. Removing permission does not delete the person's Google account or their existing Drive backup files.

Deploy the backend with the migration before distributing the APK. Build with build-Budgetly.bat and test on a real Android device:

1. Google sign-up: choose an account, return to Budgetly, enter a name, finish creation.
2. Google sign-in: switch away and back, including a brief connection interruption.
3. Cancel consent and retry; expired flows must not sign in.
4. Existing email/password accounts must still require explicit Google linking.
5. Delete a disposable Google account through Settings and another through admin management. Check Google's connections page afterward.
6. Simulate provider unavailability: deletion must leave the account and records intact.
7. Verify browser sign-in and signup continue to work.

Google token revocation removes the project's granted scopes; a separate OAuth client in the same Google project does not guarantee independent grants. Deletion intentionally removes all Budgetly access. See https://developers.google.com/identity/protocols/oauth2/web-server and https://developers.google.com/identity/protocols/oauth2/resources/best-practices.
