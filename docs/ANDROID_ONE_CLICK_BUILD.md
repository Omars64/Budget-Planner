# One-click Android release

Double-click `build-Budgetly.bat` in the repository root, or run `./build-Budgetly.bat` from PowerShell. It works regardless of the terminal's starting directory and keeps the window open to show the result.

The batch checks GitHub access, the main branch, and the original signing files. It refreshes npm dependencies when the lockfile changes or the required tools are missing, runs local tests, and builds the web assets once for both packages. After verifying the APK, Windows installer, and both manifests, it stages changes, commits them if needed, and pushes main. It waits for Vercel and the GitHub quality workflow for that commit, then uploads the files to a draft release and publishes it.

One-time setup: install GitHub CLI (`winget install --id GitHub.cli --exact`), reopen the terminal, then run `gh auth login`. Git must also be authenticated for pushes. With Python 3.13 active, run `python -m pip install -r requirements-dev.txt` to prepare the backend tests that run before packaging.

The batch publishes `Budgetly-VERSION.apk` and `update.json` from `android/app/build/outputs/apk/release`, and `Budgetly-Setup-VERSION.exe` and `windows-update.json` from `dist-desktop`. Use `-Bundle` to also build the local Play bundle at `android/app/build/outputs/bundle/release/app-release.aab`. See [Android updates](ANDROID_UPDATES.md) for device testing.

The Windows update dialog offers **Download Windows installer** when manual installation is required. To require a trusted publisher for a release, configure Electron Builder with your Windows signing identity and set `BUDGETLY_REQUIRE_WINDOWS_SIGNING=1` before starting the batch. See [Desktop application](native-apps.md#desktop-application).

Optional PowerShell commands:

```powershell
./build-Budgetly.bat -CheckOnly
./build-Budgetly.bat -BuildOnly
./build-Budgetly.bat -Message "Budgetly update: improve Google signup"
./build-Budgetly.bat -SkipInstall
./build-Budgetly.bat -BuildOnly -Bundle
./build-Budgetly.bat -Debug
./build-Budgetly.bat -JdkHome "C:\path\to\jdk-21" -SdkHome "C:\path\to\Android\Sdk"
```

`-BuildOnly` never commits, pushes or publishes. `-Debug` also implies build-only. `-SkipTests` is only allowed with build-only. `-CheckOnly` checks prerequisites without committing, pushing, building or publishing. If no source changes exist, the commit step is skipped. Set a fresh semantic version and increased Android versionCode before each new release: published releases are never overwritten. Failed draft uploads can be retried only against the same commit; otherwise resolve the draft manually. If a build modifies tracked source files, publication stops so the released APK does not silently differ from its source commit.

Keep the original `.android-signing` folder and protected password file safe. If missing, the launcher refuses a release build instead of generating a new identity. The password file is tied to the Windows user and machine. The default push triggers your configured Vercel deployment, but does not edit production records or automatically increment versions. Review source changes before running: all non-ignored changes are staged. Filename and staged-token guards catch common secrets, but are not a comprehensive secret scanner.
