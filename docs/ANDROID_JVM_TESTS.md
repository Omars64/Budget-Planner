# Android JVM tests

Prerequisites: npm dependencies (`npm ci`), JDK 21, and an Android SDK with
platform 36 and build tools. Set `JAVA_HOME` and `ANDROID_HOME` to those installations.
No emulator, signing credentials, Firebase credentials, or release build is required.

From the repository root on Windows:

```powershell
./android/gradlew.bat -p android :app:testDebugUnitTest --console=plain
```

On Linux/macOS:

```sh
bash android/gradlew -p android :app:testDebugUnitTest --console=plain
```

If Java does not trust your Windows network's certificate chain, use the existing
Windows certificate store for Gradle and the forked Robolectric JVM:

```powershell
$env:JAVA_TOOL_OPTIONS = "$env:JAVA_TOOL_OPTIONS -Djavax.net.ssl.trustStoreType=Windows-ROOT -Djavax.net.ssl.trustStore=NONE".Trim()
./android/gradlew.bat -p android :app:testDebugUnitTest --console=plain
```

Reports: `android/app/build/reports/tests/testDebugUnitTest/index.html` and
`android/app/build/test-results/testDebugUnitTest/`.

`scripts/build-android.ps1` runs this gate after web synchronization and before
debug/release assembly or release signing preparation. A failing gate stops the script.
Its existing `-UseWindowsTrustStore` option also applies to the test JVM.

The Robolectric tests exercise notification capture/filtering/redaction and consent
revocation, SQLite queue ownership/deduplication/retention/capacity/acknowledgement,
update push consent/version/deduplication, and updater URL/metadata/signing-identity
validation. They use API 28 and synthetic package certificates. Real network downloads,
APK archive parsing, installer UI, Firebase transport, and device notification access
still require integration/device verification.

## Proposed CI job

The workflow owner can add this under `jobs` in `.github/workflows/quality.yml`.
It uses the existing debug test variant, leaves release signing variables unset,
and does not build or publish a release. The app Gradle configuration already skips
the Google Services plugin when `google-services.json` is absent.

```yaml
  android-jvm:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '21'
      - uses: android-actions/setup-android@v3
        with:
          packages: platform-tools
          log-accepted-android-sdk-licenses: false
      - run: sdkmanager "platforms;android-36" "build-tools;36.0.0"
      - run: npm ci
      - run: bash android/gradlew -p android :app:testDebugUnitTest --no-daemon --console=plain
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: android-jvm-results
          path: |
            android/app/build/reports/tests/testDebugUnitTest/
            android/app/build/test-results/testDebugUnitTest/
```
