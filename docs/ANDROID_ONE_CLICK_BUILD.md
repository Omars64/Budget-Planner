# One-click Android release

Double-click `build-Budgetly.bat` in the repository root, or run `./build-Budgetly.bat` from PowerShell. It works regardless of the terminal's starting directory and keeps the window open to show the result.

Default execution publishes a release. It checks GitHub access, the main branch and original signing files; stages changes with git add .; creates a relevant versioned commit message when changes exist; pushes origin main; then installs dependencies, runs frontend tests, builds the signed APK/AAB, and verifies the update manifest. It uploads both assets to a draft GitHub release and only then publishes it as latest. Errors stop subsequent steps. A completed push is not rolled back if the build fails. No artificial waiting or Vercel deployment polling is added; backend changes should remain compatible with the previous app during deployment.

One-time setup: install GitHub CLI (`winget install --id GitHub.cli --exact`), reopen the terminal, then run `gh auth login`. Git must also be authenticated for pushes. The launcher does not collect or embed credentials.

The APK is `android/app/build/outputs/apk/release/Budgetly-VERSION.apk`. The Play bundle is `android/app/build/outputs/bundle/release/app-release.aab`. Release builds generate `update.json` beside the APK, containing its version, size, and SHA-256 checksum. Default execution publishes both automatically. See [Android updates](ANDROID_UPDATES.md) for device-testing guidance. Existing Budgetly installations detect the release on their normal update checks; this is not a push notification to closed apps.

Optional PowerShell commands:

```powershell
./build-Budgetly.bat -CheckOnly
./build-Budgetly.bat -BuildOnly
./build-Budgetly.bat -Message "Budgetly update: improve Google signup"
./build-Budgetly.bat -SkipInstall
./build-Budgetly.bat -Debug
./build-Budgetly.bat -JdkHome "C:\path\to\jdk-21" -SdkHome "C:\path\to\Android\Sdk"
```

`-BuildOnly` never commits, pushes or publishes. `-Debug` also implies build-only. `-SkipTests` is only allowed with build-only. `-CheckOnly` checks prerequisites without committing, pushing, building or publishing. If no source changes exist, the commit step is skipped. Set a fresh semantic version and increased Android versionCode before each new release: published releases are never overwritten. Failed draft uploads can be retried only against the same commit; otherwise resolve the draft manually. If a build modifies tracked source files, publication stops so the released APK does not silently differ from its source commit.

Keep the original `.android-signing` folder and protected password file safe. If missing, the launcher refuses a release build instead of generating a new identity. The password file is tied to the Windows user and machine. The default push triggers your configured Vercel deployment, but does not edit production records or automatically increment versions. Review source changes before running: all non-ignored changes are staged. Filename and staged-token guards catch common secrets, but are not a comprehensive secret scanner.
