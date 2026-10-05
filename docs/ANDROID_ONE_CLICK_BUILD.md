# One-click Android build

Double-click `build-android.bat` in the repository root, or run `./build-android.bat` from PowerShell. It works regardless of the terminal's starting directory and keeps the window open to show the result.

The default build checks Node, JDK 21, Android SDK, and the existing release signing files; stops this repository's Vite server; installs locked dependencies; checks version consistency; runs frontend tests; builds the web interface; synchronizes Capacitor; and generates the signed release APK and AAB. Errors stop the build. It uses Windows certificate trust without disabling TLS validation.

The APK is `android/app/build/outputs/apk/release/Budgetly-VERSION.apk`. The Play bundle is `android/app/build/outputs/bundle/release/app-release.aab`. Release builds also generate `update.json` beside the APK, containing its version, size, and SHA-256 checksum. Publish both the APK and `update.json` together; see [Android updates](ANDROID_UPDATES.md) for the release and device-testing checklist. The launcher does not publish a GitHub release automatically.

Optional PowerShell commands:

```powershell
./build-android.bat -CheckOnly
./build-android.bat -SkipInstall
./build-android.bat -Debug
./build-android.bat -JdkHome "C:\path\to\jdk-21" -SdkHome "C:\path\to\Android\Sdk"
```

`-SkipTests` is available for local experiments, not recommended for distributed releases. A debug APK uses a different signing key and is not a replacement for the installed release APK.

Keep the original `.android-signing` folder and its protected password file safe. If missing, the launcher refuses a release build instead of generating a new identity. The password file is tied to the Windows user and machine. Building does not change user records, deploy the backend, or automatically increment versions. Apply deliberate semantic version changes before distributing a new release.
