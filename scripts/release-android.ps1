param(
    [switch]$BuildOnly,
    [switch]$Debug,
    [switch]$SkipInstall,
    [switch]$SkipTests,
    [switch]$CheckOnly,
    [string]$Message,
    [string]$JdkHome,
    [string]$SdkHome
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'android-publish.ps1')
$buildArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot 'build-android-all.ps1'))
foreach ($flag in @('Debug', 'SkipInstall', 'SkipTests', 'CheckOnly')) {
    if (Get-Variable -Name $flag -ValueOnly) { $buildArgs += "-$flag" }
}
if ($JdkHome) { $buildArgs += @('-JdkHome', $JdkHome.TrimEnd('\')) }
if ($SdkHome) { $buildArgs += @('-SdkHome', $SdkHome.TrimEnd('\')) }
try {
    if ($BuildOnly -or $Debug) {
        & powershell.exe @buildArgs
        exit $LASTEXITCODE
    }
    if ($SkipTests -and !$CheckOnly) { throw 'Publishing requires tests. Use -BuildOnly -SkipTests for local experiments.' }
    foreach ($program in @('git.exe', 'gh.exe')) {
        if (!(Get-Command $program -ErrorAction SilentlyContinue)) {
            throw "Missing $program. Install Git and GitHub CLI, then run gh auth login once before publishing."
        }
    }
    Invoke-BudgetlyRelease -Root (Split-Path $PSScriptRoot -Parent) -BuildArguments $buildArgs -Message $Message -CheckOnly:$CheckOnly
    exit 0
} catch {
    Write-Host "RELEASE STOPPED: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'A successful Git push is not rolled back if a later build or release step fails.'
    exit 1
}
