function Invoke-BudgetlyNativeCommand([string]$Program, [string[]]$Arguments) {
    $showOutput = $Program -eq 'powershell.exe' -or $Program -eq 'npm.cmd' -or
        ($Program -eq 'git.exe' -and $Arguments[0] -in @('commit', 'push')) -or
        ($Program -eq 'gh.exe' -and $Arguments[0] -eq 'release' -and $Arguments[1] -in @('create', 'upload', 'edit'))
    $output = [System.Collections.Generic.List[string]]::new()
    $previousPreference = $ErrorActionPreference
    try {
        # Native stderr includes normal warnings. Only exit codes decide failure.
        $ErrorActionPreference = 'Continue'
        & $Program @Arguments 2>&1 | ForEach-Object {
            $line = if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.Exception.Message } else { $_.ToString() }
            if ($line -eq 'System.Management.Automation.RemoteException') { $line = '' }
            $output.Add($line)
            if ($showOutput) { Write-Host $line }
        }
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previousPreference }
    [pscustomobject]@{ ExitCode = $code; Output = $output }
}

function Get-BudgetlyFileSha256([string]$Path) {
    $stream = [System.IO.File]::OpenRead($Path)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        return [System.BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant()
    } finally {
        $stream.Dispose()
        $sha.Dispose()
    }
}

function Get-BudgetlyReleaseGate([object]$Status, [object[]]$Runs) {
    $deployment = @($Status.statuses | Where-Object { $_.context -eq 'Vercel' } | Select-Object -First 1)
    $quality = @($Runs | Sort-Object databaseId -Descending | Select-Object -First 1)
    if ($deployment.Count -and $deployment[0].state -in @('failure', 'error')) {
        throw "Vercel deployment failed: $($deployment[0].target_url). No Android update will be published."
    }
    if ($quality.Count -and $quality[0].status -eq 'completed' -and $quality[0].conclusion -ne 'success') {
        throw "GitHub quality gates did not pass ($($quality[0].conclusion)): $($quality[0].url). No Android update will be published."
    }
    return ($deployment.Count -gt 0 -and $deployment[0].state -eq 'success' -and
        $quality.Count -gt 0 -and $quality[0].status -eq 'completed' -and $quality[0].conclusion -eq 'success')
}

function Invoke-BudgetlyRelease {
    param(
        [string]$Root,
        [string[]]$BuildArguments,
        [string]$Message,
        [switch]$CheckOnly,
        [scriptblock]$Runner = {
            param($Program, $Arguments)
            Invoke-BudgetlyNativeCommand $Program $Arguments
        }
    )
    function Run([string]$Program, [string[]]$Arguments) {
        $result = & $Runner $Program $Arguments
        # Retry only read-only GitHub requests with transient transport/server errors.
        # Never retry commits, pushes, or publication blindly.
        $readOnly = $Program -eq 'gh.exe' -and ($Arguments[0] -eq 'api' -or
            ($Arguments[0] -in @('run', 'release') -and $Arguments[1] -in @('list', 'view')))
        for ($attempt = 1; $readOnly -and $result.ExitCode -ne 0 -and $attempt -lt 3; $attempt++) {
            if (($result.Output -join "`n") -notmatch '(?i)(HTTP 50[234]|TLS handshake timeout|connection reset|temporarily unavailable|i/o timeout)') { break }
            Write-Warning "Temporary GitHub connection failure; retry $attempt of 2."
            Start-Sleep -Seconds (2 * $attempt)
            $result = & $Runner $Program $Arguments
        }
        if ($result.ExitCode -ne 0) {
            if ($Program -eq 'gh.exe' -or ($Program -eq 'git.exe' -and $Arguments[0] -in @('push', 'fetch', 'commit'))) {
                foreach ($line in @($result.Output | Select-Object -Last 12)) { Write-Host $line }
            }
            throw "$Program $($Arguments[0]) failed (exit $($result.ExitCode)). See the command output above."
        }
        return ($result.Output -join "`n").Trim()
    }
    Push-Location $Root
    try {
        $pkg = Get-Content -LiteralPath (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json
        $version = $pkg.version
        if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Set a valid Major.Minor.Patch version before publishing.' }
        $tag = "v$version"
        $repo = 'Omars64/Budget-Planner'
        if ((Run git.exe @('branch', '--show-current')) -ne 'main') { throw 'Switch to main before running the release launcher.' }
        $remote = Run git.exe @('remote', 'get-url', 'origin')
        if ($remote -notin @('https://github.com/Omars64/Budget-Planner.git', 'git@github.com:Omars64/Budget-Planner.git')) { throw 'origin must point to Omars64/Budget-Planner.' }
        $null = Run gh.exe @('auth', 'status')
        $null = Run gh.exe @('api', "repos/$repo")
        $releases = Run gh.exe @('release', 'list', '--repo', $repo, '--limit', '100', '--json', 'tagName,isDraft')
        $existing = foreach ($release in (ConvertFrom-Json -InputObject $releases)) {
            if ($release.tagName -eq $tag) { $release }
        }
        if ($existing -and !$existing.isDraft) { throw "Release $tag is already published. Set a new version; existing releases are never overwritten." }
        $tracked = Run git.exe @('ls-files', '--cached', '--others', '--exclude-standard')
        foreach ($path in ($tracked -split "`n")) {
            if ($path -match '(^|/)(\.android-signing|\.vercel)/|(^|/)\.env($|\.)|\.(p12|pfx|jks|keystore|pem|key|clixml|apk|aab)$') {
                if ($path -ne '.env.example') { throw "Refusing to stage sensitive or generated file: $path. Ignore it before releasing." }
            }
        }
        $null = Run powershell.exe ($BuildArguments + '-CheckOnly' | Select-Object -Unique)
        if (!(Get-Command npm.cmd -ErrorAction SilentlyContinue) -or !(Test-Path -LiteralPath (Join-Path $Root 'node_modules/.bin/electron-builder.cmd'))) {
            throw 'Windows installer tools are missing. Run npm ci, then retry the release launcher.'
        }
        if ($CheckOnly) { Write-Host 'Release checks passed. No commit, push, build, or publication performed.'; return }

        Write-Host 'Building and testing locally before making any Git or production changes...' -ForegroundColor Cyan
        $null = Run powershell.exe $BuildArguments
        Write-Host 'Building the Windows installer from the same tested source...' -ForegroundColor Cyan
        $env:NODE_USE_SYSTEM_CA = '1'
        $null = Run npm.cmd @('run', 'desktop:installer')
        $null = Run node.exe @('scripts/windows-release-manifest.mjs')
        $windowsDirectory = Join-Path $Root 'dist-desktop'
        $installer = Join-Path $windowsDirectory "Budgetly-Setup-$version.exe"
        $windowsManifestPath = Join-Path $windowsDirectory 'windows-update.json'
        $windowsManifest = Get-Content -LiteralPath $windowsManifestPath -Raw | ConvertFrom-Json
        $windowsFile = Get-Item -LiteralPath $installer
        if ($windowsManifest.version -ne $version -or $windowsManifest.size -ne $windowsFile.Length -or
            $windowsManifest.sha256 -ne (Get-BudgetlyFileSha256 $installer) -or
            $windowsManifest.url -ne "https://github.com/$repo/releases/download/$tag/Budgetly-Setup-$version.exe") {
            throw 'Windows installer and update manifest do not match. Nothing will be pushed or published.'
        }
        $directory = Join-Path $Root 'android/app/build/outputs/apk/release'
        $apk = Join-Path $directory "Budgetly-$version.apk"
        $manifestPath = Join-Path $directory 'update.json'
        $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
        $file = Get-Item -LiteralPath $apk
        if ($manifest.version -ne $version -or $manifest.versionCode -ne $pkg.androidVersionCode -or
            $manifest.packageId -ne 'com.flowbudget.app' -or $manifest.size -ne $file.Length -or
            $manifest.sha256 -ne (Get-BudgetlyFileSha256 $apk) -or
            $manifest.url -ne "https://github.com/$repo/releases/download/$tag/Budgetly-$version.apk") {
            throw 'APK and update manifest do not match. Nothing will be pushed or published.'
        }
        $null = Run git.exe @('add', '.')
        $patch = Run git.exe @('diff', '--cached', '--no-color')
        if ($patch -match '(?m)^\+(?!\+).*?(-----BEGIN [A-Z ]*PRIVATE KEY-----|GOCSPX-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-proj-[A-Za-z0-9_-]{20,})') {
            throw 'A possible private key or API token is staged. Remove the secret before committing or publishing.'
        }
        $changed = Run git.exe @('diff', '--cached', '--name-only')
        if ($changed) {
            if (!$Message) {
                $areas = @()
                if ($changed -match '(?im)(google|auth|src/App\.)') { $areas += 'authentication' }
                if ($changed -match '(?im)(build-android|release-android|android-publish|android-release|ANDROID_|android/)') { $areas += 'Android releases' }
                if ($changed -match '(?im)(transaction|wallet|budget|ledger|upcoming|planner)') { $areas += 'finance' }
                if (!$areas.Count) { $areas = @('app improvements') }
                $Message = "Budgetly ${version}: update $($areas -join ', ')"
            }
            $null = Run git.exe @('commit', '-m', $Message)
        } else { Write-Host 'No staged changes; using the current commit.' }
        $null = Run git.exe @('push', 'origin', 'main')
        $commit = Run git.exe @('rev-parse', 'HEAD')
        $null = Run git.exe @('diff', '--exit-code')
        $null = Run git.exe @('diff', '--cached', '--exit-code')
        Write-Host 'Verifying Vercel deployment and GitHub quality gates for this exact commit before publication...'
        $deadline = [DateTime]::UtcNow.AddMinutes(20)
        do {
            $deploymentStatus = Run gh.exe @('api', "repos/$repo/commits/$commit/status") | ConvertFrom-Json
            $qualityRuns = Run gh.exe @('run', 'list', '--repo', $repo, '--workflow', 'quality.yml', '--commit', $commit,
                '--event', 'push', '--limit', '10', '--json', 'databaseId,status,conclusion,url') | ConvertFrom-Json
            try {
                if (Get-BudgetlyReleaseGate $deploymentStatus @($qualityRuns)) { break }
            } catch {
                $failure = $_
                $failedRun = @($qualityRuns | Sort-Object databaseId -Descending | Select-Object -First 1)
                if ($failedRun.Count -and $failedRun[0].conclusion -eq 'failure') {
                    Write-Host 'GitHub failed-check diagnostics:' -ForegroundColor Yellow
                    $diagnostic = & $Runner gh.exe @('run', 'view', [string]$failedRun[0].databaseId, '--repo', $repo, '--log-failed')
                    $diagnostic.Output | Select-Object -Last 100 | ForEach-Object { Write-Host $_ }
                }
                Write-Host "The APK is retained at $apk. Fix the reported checks and rerun build-Budgetly.bat; no force push or version change is required for this unpublished release."
                throw $failure
            }
            if ([DateTime]::UtcNow -ge $deadline) { throw 'Timed out waiting for deployment/quality checks. APK remains local; fix checks and rerun this version.' }
            Start-Sleep -Seconds 10
        } while ($true)
        if ($existing) {
            $draft = Run gh.exe @('release', 'view', $tag, '--repo', $repo, '--json', 'targetCommitish') | ConvertFrom-Json
            if ($draft.targetCommitish -ne $commit) { throw "Existing draft $tag targets a different commit. Resolve it manually before retrying." }
            $null = Run gh.exe @('release', 'upload', $tag, $apk, $manifestPath, $installer, $windowsManifestPath, '--repo', $repo, '--clobber')
        } else {
            $null = Run gh.exe @('release', 'create', $tag, $apk, $manifestPath, $installer, $windowsManifestPath, '--repo', $repo,
                '--target', $commit, '--title', "Budgetly $version", '--generate-notes', '--draft')
        }
        $null = Run gh.exe @('release', 'edit', $tag, '--repo', $repo, '--draft=false', '--latest')
        Write-Host "RELEASE PUBLISHED: https://github.com/$repo/releases/tag/$tag" -ForegroundColor Green
        Write-Host 'GitHub release alerts run automatically when UPDATE_RELEASE_SECRET is configured. Daily update checks provide a fallback.'
        if ($env:BUDGETLY_UPDATE_PUSH_SECRET) {
            try {
                $result = Invoke-RestMethod -Method Post -Uri 'https://budget-planner-ecru-seven.vercel.app/api/maintenance/updates' -Headers @{Authorization="Bearer $env:BUDGETLY_UPDATE_PUSH_SECRET"} -TimeoutSec 30
                Write-Host "Update push: $($result.sent) accepted by providers, $($result.failed) pending retry. Receipt on devices is not confirmed."
            } catch { Write-Warning 'Release published, but immediate push could not complete. Daily maintenance will retry; check deployment and push configuration.' }
        }
        Write-Host 'Vercel deployment and GitHub quality gates passed for the released commit.'
    } finally { Pop-Location }
}
