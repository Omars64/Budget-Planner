# Android releases and updates

Budgetly checks the public GitHub release manifest after sign-in and when returning to the app (at most once per six hours per running session). Network failures never prevent normal use. Settings offers a manual check. Updates are optional: dismiss the notice or choose Update. The native plugin downloads with progress, verifies size and SHA-256, and rejects a different package, signing certificate, or non-increasing Android versionCode before opening Android's installer. No account token or financial data is sent to GitHub.

## Publish each release

1. Keep `com.flowbudget.app` and the original release signing key. Set the semantic version and increase `androidVersionCode` in package.json; run `npm run version:sync`.
2. For physical-device acceptance before publication, run `build-android.bat -BuildOnly`. The signed release APK and `update.json` are created together under `android/app/build/outputs/apk/release/`. Do not use a debug APK.
3. Once ready, double-click `build-android.bat`: it automatically stages, commits, pushes main, rebuilds and tests, uploads both assets to a draft release tagged `vVERSION`, then publishes it as latest. It requires GitHub CLI and prior `gh auth login`; see [One-click release](ANDROID_ONE_CLICK_BUILD.md). Do not run a separate release-create command afterward. No Vercel deployment wait is added.
4. Manual publication remains possible after `-BuildOnly`: create a release in the PUBLIC `Omars64/Budget-Planner` repository with both `Budgetly-VERSION.apk` and `update.json`, mark latest and not prerelease. Publishing makes the APK publicly downloadable; the source push triggers the configured backend deployment separately. Never upload signing keys, password files, OAuth secrets, or database backups. If the repository becomes private, move distribution to a public release repository and update the pinned addresses in both JS and Java.

The stable download page is `https://budget-planner-ecru-seven.vercel.app/download` after deploying these web changes. Both clients read `/api/app-updates/latest`, a public five-minute-cached metadata endpoint that proxies `https://github.com/Omars64/Budget-Planner/releases/latest/download/update.json` with a fixed repository, bounded responses, and restricted redirects. No user authorization is forwarded to GitHub. Until the first release contains that manifest, no automatic update is offered. Existing older APKs need this updater-enabled APK installed once manually before they can detect future releases. Default batch execution now publishes automatically; `-BuildOnly` prepares artifacts without publication.

GitHub hosts the release APK. Your account and transaction database remain on the existing backend. Release download checks are not silent installation, remote push notifications, or background auto-updates while the app is closed.

## Android consent and compatibility

Budgetly requests `REQUEST_INSTALL_PACKAGES` solely for its verified update installation. Android may ask users to allow installing from Budgetly; the user chooses this permission and then taps Install again. They must also approve the installer. This permission is not enabled automatically. No SMS, accessibility, overlay, or notification-listener permission is added. Because banking apps can have their own security checks, validate coexistence on supported phones before distribution.

## Physical-device acceptance

- Install the first updater-enabled signed release manually without uninstalling the existing app; confirm account, drafts, wallets, and transactions remain intact.
- Publish a higher-code test release only in a controlled distribution test; verify detection, progress, permission return, installer confirmation, and subsequent version display.
- Reject checksum mismatch, truncated download, wrong signer, wrong package, and old version; retry safely after network loss.
- Check offline startup, dismiss notice, manual retry, insufficient storage, and cancelled installer.
- Test Samsung/other supported phones with installed banking apps. Native compilation and mocked JS tests do not establish real installer behavior.

Keep the release repository account protected with MFA and maintain an offline signing-key backup. SHA-256 catches corruption; the original installed signing certificate is the independent trust boundary. Key rotation is intentionally not accepted by this initial updater.
