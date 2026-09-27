$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path.TrimEnd('\')

try {
    $viteProcesses = @(Get-CimInstance Win32_Process -Filter "name = 'node.exe'" |
        Where-Object {
            $_.CommandLine -and
            $_.CommandLine.IndexOf($projectRoot + '\node_modules\', [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
            $_.CommandLine -match '[\\/]vite[\\/]bin[\\/]vite\.js'
        })
} catch {
    throw "Cannot inspect running Vite processes. Stop this project's Vite server manually, then run npm ci. $($_.Exception.Message)"
}

foreach ($viteProcess in $viteProcesses) {
    Write-Host "Stopping Budgetly Vite process $($viteProcess.ProcessId) before reinstalling dependencies."
    Stop-Process -Id $viteProcess.ProcessId -ErrorAction Stop
}

foreach ($viteProcess in $viteProcesses) {
    $processId = $viteProcess.ProcessId
    for ($attempt = 0; $attempt -lt 50 -and (Get-Process -Id $processId -ErrorAction SilentlyContinue); $attempt++) {
        Start-Sleep -Milliseconds 100
    }
    if (Get-Process -Id $processId -ErrorAction SilentlyContinue) {
        throw "Vite process $processId did not exit. Close it before running npm ci."
    }
}

Push-Location $projectRoot
try {
    & npm.cmd ci --offline=false
    if ($LASTEXITCODE -ne 0) {
        throw "npm ci failed with exit code $LASTEXITCODE. If EPERM persists, check antivirus or another process holding node_modules open."
    }
} finally {
    Pop-Location
}
