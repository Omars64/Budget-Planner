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
$buildLock = $null
$transcribing = $false
try {
    $root = Split-Path $PSScriptRoot -Parent
    $logDirectory = Join-Path $root '.verification/build-logs'
    $null = New-Item -ItemType Directory -Path $logDirectory -Force
    try {
        $buildLock = [System.IO.File]::Open((Join-Path $root '.verification/budgetly-build.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
    } catch { throw 'Another Budgetly build is running. Wait for it to finish before starting another build.' }
    $log = Join-Path $logDirectory ("build-{0}-{1}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss'), $PID)
    $null = Start-Transcript -LiteralPath $log
    $transcribing = $true
    Write-Host "Build diagnostics: $log"
    if ($BuildOnly -or $Debug) {
        $result = Invoke-BudgetlyNativeCommand powershell.exe $buildArgs
        exit $result.ExitCode
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
} finally {
    if ($transcribing) { $null = Stop-Transcript }
    if ($buildLock) { $buildLock.Dispose() }
}
