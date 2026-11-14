# FlowBudget installed applications

## Current implementation and boundaries

- Server-verified passkeys: explicit Password / Biometric choice, registration after password confirmation, single-use five-minute challenges, revocation. The legacy browser-stored bearer token is removed. Users must register again.
- Android and iOS Capacitor projects bundle the React UI and use the same hosted API and database. They are native installable application projects, not browser shortcuts.
- Native reminder scheduling uses the operating system and permission prompt. Sign-out cancels reminders. In the browser, reminders still require an open page; web push is not configured.
- Android SMS capture is disabled as of 8 September 2026: no SMS permission or receiver is included. Existing queued alerts are preserved and can still sync, but new alerts must be added manually. See [the compatibility investigation](android-bank-compatibility.md).
- iPhone in Kuwait cannot expose the SMS inbox through a supported API for this finance app. Apple's carrier messaging API requires a default SMS app and EU eligibility. No native implementation can promise equivalent silent SMS capture under these constraints.
- The phone-number field was removed from signup/settings because it was not used for notifications or capture. Existing stored phone data is not erased.

## Build mobile projects

1. Install Node.js and run `npm ci`.
2. Run `node scripts/build-native.mjs`. By default the API is https://budget-planner-ecru-seven.vercel.app. Set FLOWBUDGET_API_URL to change it before building.
3. Android: install Android Studio with the SDK required by android/variables.gradle, and compatible JDK. Open `android` and build/sign an APK for distribution or AAB for Google Play. A release signing key must be held privately; never commit it.
4. iOS: on a Mac, open ios/App/App.xcodeproj in Xcode, select the Apple development team and a physical device, then archive for TestFlight/App Store. Windows cannot sign/build the iOS release.
5. Test on physical devices: notifications while closed, permission denial, force-stop/reboot behavior, bank sender filters, offline pending messages, account switching, and removal/reinstall. Native SMS code has not yet passed an Android compile/device test in this environment.

Do not reintroduce SMS, accessibility, notification-listener or overlay permissions without a separate compatibility review and the required store approval. Rebuilding and signing the native application is required to remove permissions from an installed APK; website deployments do not update native manifests.

## Backend configuration

Set CORS_ORIGINS to include the website and native origins, normally `https://localhost` (Android) and `capacitor://localhost` (iOS). Use explicit origins, not a wildcard. Deploy requirements.txt changes and api/passkeys.py together.

WEBAUTHN_ORIGIN defaults to the production website above. Set it to the exact website origin for another deployment; the RP ID is derived from it. Web passkeys require HTTPS (localhost is suitable for development). Native WebViews need a separate native credential bridge and website association configuration before passkeys can work there; password login remains available. The current verified passkey implementation targets browsers.

## Desktop application

Budgetly for Windows is an Electron build with bundled assets and the hosted API.

- **Direct Windows installer.** Build with `npm run desktop:installer`. Set `BUDGETLY_REQUIRE_WINDOWS_SIGNING=1` for the release packaging workflow when a trusted signing identity is available. The installed app and setup executable must have valid Authenticode signatures from the same publisher. The in-app updater verifies the release checksum and publisher and runs the installer in the existing installation scope. Existing unsigned installations need a one-time transition to a trusted build.
- **Microsoft Store.** Create and verify a Microsoft Partner Center developer account and reserve the app name. Copy the package identity, publisher certificate subject and publisher display name from the app's Product identity page into `BUDGETLY_STORE_IDENTITY`, `BUDGETLY_STORE_PUBLISHER` and `BUDGETLY_STORE_PUBLISHER_DISPLAY_NAME`. On Windows, run `npm run desktop:store` and submit the AppX from `dist-desktop/store`. Microsoft signs approved packages and delivers subsequent updates through the Store. Store installations use Windows package identity and rely on the Store to update. Before switching channels, save a copy of guest or other local-only data.

See [Microsoft's code-signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options) and [developer account registration](https://learn.microsoft.com/en-us/windows/apps/publish/partner-center/open-a-developer-account).

## SMS across both platforms

The practical shared alternative is a bank-supported transaction API or bank email alerts delivered to a dedicated inbound mailbox. It requires bank/provider coverage and explicit account consent. No provider credentials or inbound mail service are configured here. Keep this feature unavailable until the connection is verified; a phone number alone does not grant SMS access.

Sources:
- https://support.google.com/googleplay/android-developer/answer/10208820
- https://developer.apple.com/documentation/TelephonyMessagingKit
- https://capacitorjs.com/docs/apis/local-notifications
