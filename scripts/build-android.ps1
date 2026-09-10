param([string]$JdkHome, [string]$SdkHome, [switch]$UseWindowsTrustStore, [switch]$Release)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1')
$projectRoot = Split-Path $PSScriptRoot -Parent
if (!$JdkHome) {
    $bundled = Get-ChildItem (Join-Path $projectRoot '.verification/toolchain') -Directory -Filter 'jdk-21*' -ErrorAction SilentlyContinue | Select-Object -First 1
    $JdkHome = if ($bundled) { $bundled.FullName } else { $env:JAVA_HOME }
}
if (!$JdkHome -or !(Test-Path (Join-Path $JdkHome 'bin/java.exe'))) {
    throw 'Set JAVA_HOME to JDK 21, or pass -JdkHome with its installed folder.'
}
if (!$SdkHome) { $SdkHome = Join-Path $env:LOCALAPPDATA 'Android/Sdk' }
if (!(Test-Path $SdkHome)) { throw 'Android SDK not found. Pass -SdkHome with its installed folder.' }
$env:JAVA_HOME = $JdkHome
$env:ANDROID_HOME = $SdkHome
$env:ANDROID_SDK_ROOT = $SdkHome
if ($UseWindowsTrustStore) {
    $env:JAVA_TOOL_OPTIONS = "$env:JAVA_TOOL_OPTIONS -Djavax.net.ssl.trustStoreType=Windows-ROOT -Djavax.net.ssl.trustStore=NONE".Trim()
}
Push-Location $projectRoot
try {
    & npm.cmd run android:sync
    if ($LASTEXITCODE -ne 0) { throw 'Web build or Android sync failed.' }
    if ($Release) {
        $signingDir = Join-Path $projectRoot '.android-signing'
        $keyFile = Join-Path $signingDir 'flowbudget-upload.p12'
        $passwordFile = Join-Path $signingDir 'password.clixml'
        New-Item -ItemType Directory -Path $signingDir -Force | Out-Null
        if ((Test-Path $keyFile) -and !(Test-Path $passwordFile)) {
            throw 'The signing key exists but its protected password is missing. Restore password.clixml; do not generate a replacement key.'
        }
        if (!(Test-Path $passwordFile)) {
            $randomBytes = New-Object byte[] 32
            $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
            $rng.GetBytes($randomBytes)
            $rng.Dispose()
            $securePassword = ConvertTo-SecureString ([Convert]::ToBase64String($randomBytes)) -AsPlainText -Force
            $securePassword | Export-Clixml -LiteralPath $passwordFile
        }
        $securePassword = Import-Clixml -LiteralPath $passwordFile
        $credential = New-Object System.Management.Automation.PSCredential('flowbudget', $securePassword)
        $env:FLOWBUDGET_STORE_FILE = $keyFile
        $env:FLOWBUDGET_STORE_PASSWORD = $credential.GetNetworkCredential().Password
        if (!(Test-Path $keyFile)) {
            & (Join-Path $JdkHome 'bin/keytool.exe') -genkeypair -keystore $keyFile -storetype PKCS12 -alias flowbudget -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=FlowBudget' -storepass:env FLOWBUDGET_STORE_PASSWORD -keypass:env FLOWBUDGET_STORE_PASSWORD
            if ($LASTEXITCODE -ne 0) { throw 'Could not create the signing key.' }
        }
        & ./android/gradlew.bat -p android assembleRelease bundleRelease --no-daemon
    } else {
        & ./android/gradlew.bat -p android assembleDebug --no-daemon
    }
    if ($LASTEXITCODE -ne 0) { throw 'Android compilation failed.' }
    $variant = if ($Release) { 'release' } else { 'debug' }
    $apkDir = Join-Path $projectRoot "android/app/build/outputs/apk/$variant"
    $metadata = Get-Content (Join-Path $apkDir 'output-metadata.json') -Raw | ConvertFrom-Json
    $version = $metadata.elements[0].versionName
    $name = if ($Release) { "FlowBudget-$version.apk" } else { "FlowBudget-$version-test.apk" }
    $output = Join-Path $apkDir $name
    Copy-Item -LiteralPath (Join-Path $apkDir "app-$variant.apk") -Destination $output -Force
    Write-Output "Installable APK: $output"
    if ($Release) { Write-Output 'Play bundle: android/app/build/outputs/bundle/release/app-release.aab' }
} finally {
    Remove-Item Env:FLOWBUDGET_STORE_FILE, Env:FLOWBUDGET_STORE_PASSWORD -ErrorAction SilentlyContinue
    Pop-Location
}
