function Invoke-BudgetlyRelease {
    param(
        [string]$Root,
        [string[]]$BuildArguments,
        [string]$Message,
        [switch]$CheckOnly,
        [scriptblock]$Runner = {
            param($Program, $Arguments)
            $output = @(& $Program @Arguments)
            $code = $LASTEXITCODE
            $showOutput = $Program -eq 'powershell.exe' -or
                ($Program -eq 'git.exe' -and $Arguments[0] -in @('commit', 'push')) -or
                ($Program -eq 'gh.exe' -and $Arguments[0] -eq 'release' -and $Arguments[1] -in @('create', 'upload', 'edit'))
            if ($showOutput) { foreach ($line in $output) { Write-Host $line } }
            [pscustomobject]@{ ExitCode = $code; Output = $output }
        }
    )
    function Run([string]$Program, [string[]]$Arguments) {
        $result = & $Runner $Program $Arguments
        if ($result.ExitCode -ne 0) { throw "$Program $($Arguments[0]) failed (exit $($result.ExitCode))." }
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
            if ($path -match '(^|/)(\.android-signing|\.vercel)/|(^|/)\.env($|\.)|\.(p12|jks|keystore|pem|key|clixml|apk|aab)$') {
                if ($path -ne '.env.example') { throw "Refusing to stage sensitive or generated file: $path. Ignore it before releasing." }
            }
        }
        $null = Run powershell.exe ($BuildArguments + '-CheckOnly' | Select-Object -Unique)
        if ($CheckOnly) { Write-Host 'Release checks passed. No commit, push, build, or publication performed.'; return }

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
        $null = Run powershell.exe $BuildArguments
        $null = Run git.exe @('diff', '--exit-code')
        $null = Run git.exe @('diff', '--cached', '--exit-code')
        $directory = Join-Path $Root 'android/app/build/outputs/apk/release'
        $apk = Join-Path $directory "Budgetly-$version.apk"
        $manifestPath = Join-Path $directory 'update.json'
        $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
        $file = Get-Item -LiteralPath $apk
        if ($manifest.version -ne $version -or $manifest.versionCode -ne $pkg.androidVersionCode -or
            $manifest.packageId -ne 'com.flowbudget.app' -or $manifest.size -ne $file.Length -or
            $manifest.sha256 -ne (Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash.ToLowerInvariant() -or
            $manifest.url -ne "https://github.com/$repo/releases/download/$tag/Budgetly-$version.apk") {
            throw 'APK and update manifest do not match. Nothing will be published.'
        }
        if ($existing) {
            $draft = Run gh.exe @('release', 'view', $tag, '--repo', $repo, '--json', 'targetCommitish') | ConvertFrom-Json
            if ($draft.targetCommitish -ne $commit) { throw "Existing draft $tag targets a different commit. Resolve it manually before retrying." }
            $null = Run gh.exe @('release', 'upload', $tag, $apk, $manifestPath, '--repo', $repo, '--clobber')
        } else {
            $null = Run gh.exe @('release', 'create', $tag, $apk, $manifestPath, '--repo', $repo,
                '--target', $commit, '--title', "Budgetly $version", '--generate-notes', '--draft')
        }
        $null = Run gh.exe @('release', 'edit', $tag, '--repo', $repo, '--draft=false', '--latest')
        Write-Host "RELEASE PUBLISHED: https://github.com/$repo/releases/tag/$tag" -ForegroundColor Green
        Write-Host 'Budgetly will discover this release through normal update checks. Configured closed-app push is also dispatched by daily maintenance.'
        if ($env:BUDGETLY_UPDATE_PUSH_SECRET) {
            try {
                $result = Invoke-RestMethod -Method Post -Uri 'https://budget-planner-ecru-seven.vercel.app/api/maintenance/updates' -Headers @{Authorization="Bearer $env:BUDGETLY_UPDATE_PUSH_SECRET"} -TimeoutSec 30
                Write-Host "Update push: $($result.sent) delivered, $($result.failed) pending retry."
            } catch { Write-Warning 'Release published, but immediate push could not complete. Daily maintenance will retry; check deployment and push configuration.' }
        }
        Write-Host 'Vercel deployment is triggered by Git push; this launcher does not wait for its result.'
    } finally { Pop-Location }
}
