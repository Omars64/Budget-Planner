param(
    [switch]$Debug,
    [switch]$SkipInstall,
    [switch]$SkipTests,
    [switch]$CheckOnly,
    [string]$JdkHome,
    [string]$SdkHome
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent

function Invoke-Step([string]$Name, [scriptblock]$Action) {
    Write-Host "`n=== $Name ===" -ForegroundColor Cyan
    & $Action
    if ($LASTEXITCODE -ne 0) { throw "$Name failed (exit $LASTEXITCODE)." }
}

try {
    foreach ($command in @('node.exe', 'npm.cmd')) {
        if (!(Get-Command $command -ErrorAction SilentlyContinue)) { throw "Install Node.js with npm; $command was not found." }
    }
    if (!$JdkHome) {
        $candidates = @($env:JAVA_HOME, (Join-Path $env:ProgramFiles 'Android/Android Studio/jbr'))
        $adoptium = Join-Path $env:ProgramFiles 'Eclipse Adoptium'
        if (Test-Path -LiteralPath $adoptium) {
            $candidates += @(Get-ChildItem -LiteralPath $adoptium -Directory -Filter 'jdk-21*' | Sort-Object Name -Descending | ForEach-Object FullName)
        }
        $JdkHome = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath (Join-Path $_ 'bin/java.exe')) } | Select-Object -First 1
    }
    if (!$JdkHome -or !(Test-Path -LiteralPath (Join-Path $JdkHome 'bin/java.exe'))) { throw 'JDK 21 was not found. Set JAVA_HOME or pass -JdkHome.' }
    $JdkHome = (Resolve-Path -LiteralPath $JdkHome).Path.TrimEnd('\')
    # Java prints its version to stderr; Windows PowerShell must not treat that as a terminating error.
    $ErrorActionPreference = 'Continue'
    $javaVersion = & (Join-Path $JdkHome 'bin/java.exe') -version 2>&1
    $ErrorActionPreference = 'Stop'
    if ($LASTEXITCODE -ne 0 -or ($javaVersion -join ' ') -notmatch 'version "21[.\"]') { throw 'This Android project requires JDK 21. Pass -JdkHome with the correct installation.' }
    if (!$SdkHome) {
        $SdkHome = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } elseif ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { Join-Path $env:LOCALAPPDATA 'Android/Sdk' }
    }
    if (!(Test-Path -LiteralPath (Join-Path $SdkHome 'platform-tools'))) { throw 'Android SDK platform-tools were not found. Install the Android SDK or pass -SdkHome.' }
    $SdkHome = (Resolve-Path -LiteralPath $SdkHome).Path.TrimEnd('\')
    if (!$Debug) {
        foreach ($file in @('flowbudget-upload.p12', 'password.clixml')) {
            if (!(Test-Path -LiteralPath (Join-Path $projectRoot ".android-signing/$file"))) {
                throw "Existing release signing file $file is missing. Restore the original signing files; this launcher will not generate a replacement key. Use -Debug only for a test APK."
            }
        }
    }
    Write-Host "JDK: $JdkHome"
    Write-Host "Android SDK: $SdkHome"
    Write-Host 'Existing app version and signing identity are preserved. No deployment or database changes are performed.'
    if ($CheckOnly) { Write-Host 'Prerequisite check passed.'; exit 0 }

    Push-Location $projectRoot
    try {
        # Child PowerShell processes make nonzero script exits fail the pipeline reliably.
        if (!$SkipInstall) {
            $env:NODE_USE_SYSTEM_CA = '1'
            Invoke-Step 'Install locked dependencies (stops this project Vite server)' {
                & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'install-deps.ps1')
            }
        }
        Invoke-Step 'Check app and Android version consistency' { & npm.cmd run version:check }
        if (!$SkipTests) {
            Invoke-Step 'Frontend regression tests' { & npm.cmd test -- --maxWorkers=2 }
        }
        $buildArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot 'build-android.ps1'), '-JdkHome', $JdkHome, '-SdkHome', $SdkHome, '-UseWindowsTrustStore')
        if (!$Debug) { $buildArgs += '-Release' }
        Invoke-Step 'Build web assets, sync Android, and compile APK' { & powershell.exe @buildArgs }
        if (!$Debug) { Invoke-Step 'Prepare verified GitHub update manifest' { & node.exe (Join-Path $PSScriptRoot 'android-release-manifest.mjs') } }
        Write-Host "`nBUILD SUCCESSFUL. APK location is printed above." -ForegroundColor Green
    } finally { Pop-Location }
    exit 0
} catch {
    Write-Host "`nBUILD FAILED: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
