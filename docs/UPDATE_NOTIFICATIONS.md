# Update Notifications (5.10.0)

Settings > Notifications > New Budgetly updates controls automatic in-app and device update alerts on this device. It does not prevent manual checks or updating. Guests can control local update alerts, but remote subscriptions require an account. No sign-in is required to install a publicly available Android update.

## Working Without Cloud Push Configuration

Android checks the official release manifest; browser checks the deployed backend version. Checks occur on opening/resuming and every six hours while visible. Device alerts require OS permission, requested only through a settings action. Versions are deduplicated. Browser Update reloads the site; Android Update uses the existing signature/checksum-verified installer.

## Activate Closed-App Delivery

1. Apply the additive Alembic migration (`python -m alembic upgrade head`) in staging first. Existing financial tables and data are unchanged.
2. Create Firebase project on the free Spark plan. Register Android package `com.flowbudget.app`. Put its public `google-services.json` at `android/app/google-services.json`, rebuild the APK, and install over the existing app with the same signing key. Do not change the package ID or signer.
3. Enable the FCM HTTP v1 API. Create a narrowly scoped service account permitted to send FCM messages. Store its JSON privately in Vercel Production `FIREBASE_SERVICE_ACCOUNT_JSON`. Never put this private JSON in the APK or repository.
4. Generate a Fernet key for `UPDATE_PUSH_ENCRYPTION_KEY`; keep it stable. Subscriptions are encrypted with this key. Rotating it without re-encryption invalidates existing subscriptions.
5. Generate a P-256 VAPID key pair with the installed `py-vapid` tool (`vapid --gen`). Set Vercel `WEB_PUSH_PRIVATE_KEY` to the private PEM content, `WEB_PUSH_PUBLIC_KEY` to the base64url uncompressed public key, and `WEB_PUSH_SUBJECT=mailto:<your-support-email>`. Never commit private keys. Use separate staging keys.
6. Redeploy. `/api/app-updates/push-config` returns only booleans and the public browser key. Android also checks that Firebase is initialized locally; missing configuration never starts registration.
7. Users sign in, enable New Budgetly updates, grant OS permission, and save. Saving reports setup/permission limitations. Browser service worker handles only notifications: it does not intercept fetches, cache pages or read financial records.
8. Set the existing Vercel `CRON_SECRET`. Daily maintenance dispatches new versions. On Hobby this means up to a day of delay, plus platform delivery delays. Each run is bounded; larger audiences require a queue/worker rather than increasing the serverless execution time.
9. Optional immediate dispatch after publishing: set local `BUDGETLY_UPDATE_PUSH_SECRET` to the same cron secret (outside the repository). The batch publisher calls the protected production endpoint after publication. Failure does not undo a successful release; daily maintenance retries. The new backend must already be deployed for immediate dispatch to work.

## Delivery Safety and Limitations

- Android data-only pushes check a native opt-out flag before displaying, including while the app is closed. Turning off unregisters the token and cancels the visible update notification.
- Browser opt-out unsubscribes the browser endpoint. Server unsubscribe is authenticated and scoped to the account/device.
- Account deletion removes push subscriptions. Generic app-update alerts contain no account name, financial records or balances.
- Failed sends remain eligible for retry; expired endpoints are removed. Devices not refreshed for 180 days are pruned. Ten devices per account are allowed.
- Push is not guaranteed: permission, browser support, network, battery policies and Android force-stop affect delivery. A force-stopped Android app must be reopened. Browser support varies, especially on mobile; open-app checks remain the fallback.
- FCM does not require enabling a paid Firebase plan for this integration. Hosting/database usage still counts toward provider quotas. No billing was enabled by this code change.

## Acceptance Checks Before Activation

Test on real Android and supported desktop browsers: permission denied; permission allowed; closed app/tab; click opens app; equal/older version ignored; newer version once; off blocks queued pushes; off while offline; retry on reconnect; reinstall/update preserves data and signer; account deletion removes subscriptions; staging cannot push to production; provider credentials never appear in API responses/logs. Live delivery is not considered verified until these tests run with actual credentials.
