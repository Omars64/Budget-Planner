# FlowBudget installed applications

## Current implementation and boundaries

- Server-verified passkeys: explicit Password / Biometric choice, registration after password confirmation, single-use five-minute challenges, revocation. The legacy browser-stored bearer token is removed. Users must register again.
- Android and iOS Capacitor projects bundle the React UI and use the same hosted API and database. They are native installable application projects, not browser shortcuts.
- Native reminder scheduling uses the operating system and permission prompt. Sign-out cancels reminders. In the browser, reminders still require an open page; web push is not configured.
- Android Bank messages includes exact sender configuration and a permission prompt. A RECEIVE_SMS receiver captures matching new KWD alerts in private app storage, excluding common OTP/security text. Alerts upload when the app opens or regains focus, with server deduplication. It does not read SMS history or change the default SMS app. This is not continuous background cloud upload.
- iPhone in Kuwait cannot expose the SMS inbox through a supported API for this finance app. Apple's carrier messaging API requires a default SMS app and EU eligibility. No native implementation can promise equivalent silent SMS capture under these constraints.
- The phone-number field was removed from signup/settings because it was not used for notifications or capture. Existing stored phone data is not erased.

## Build mobile projects

1. Install Node.js and run `npm ci`.
2. Run `node scripts/build-native.mjs`. By default the API is https://budget-planner-ecru-seven.vercel.app. Set FLOWBUDGET_API_URL to change it before building.
3. Android: install Android Studio with the SDK required by android/variables.gradle, and compatible JDK. Open `android` and build/sign an APK for distribution or AAB for Google Play. A release signing key must be held privately; never commit it.
4. iOS: on a Mac, open ios/App/App.xcodeproj in Xcode, select the Apple development team and a physical device, then archive for TestFlight/App Store. Windows cannot sign/build the iOS release.
5. Test on physical devices: notifications while closed, permission denial, force-stop/reboot behavior, bank sender filters, offline pending messages, account switching, and removal/reinstall. Native SMS code has not yet passed an Android compile/device test in this environment.

The Android SMS permission requires a Play Console declaration and approval under the SMS-based money management exception. Do not request SEND_SMS or default-SMS-handler privileges.

## Backend configuration

Set CORS_ORIGINS to include the website and native origins, normally `https://localhost` (Android) and `capacitor://localhost` (iOS). Use explicit origins, not a wildcard. Deploy requirements.txt changes and api/passkeys.py together.

WEBAUTHN_ORIGIN defaults to the production website above. Set it to the exact website origin for another deployment; the RP ID is derived from it. Web passkeys require HTTPS (localhost is suitable for development). Native WebViews need a separate native credential bridge and website association configuration before passkeys can work there; password login remains available. The current verified passkey implementation targets browsers.

## Desktop application

For a Windows installer, use a packaged Tauri or Electron desktop client with bundled assets and the same API, secure credential storage, native notification scheduling, and signed updates. For macOS add notarization and Apple signing; Linux can use AppImage/deb. Desktop packaging has not been implemented in this patch. Keep the server on Vercel so every client uses the same accounts and shared wallets. Do not bundle SMTP/database credentials into any client.

## SMS across both platforms

The practical shared alternative is a bank-supported transaction API or bank email alerts delivered to a dedicated inbound mailbox. It requires bank/provider coverage and explicit account consent. No provider credentials or inbound mail service are configured here. Keep this feature unavailable until the connection is verified; a phone number alone does not grant SMS access.

Sources:
- https://support.google.com/googleplay/android-developer/answer/10208820
- https://developer.apple.com/documentation/TelephonyMessagingKit
- https://capacitorjs.com/docs/apis/local-notifications
