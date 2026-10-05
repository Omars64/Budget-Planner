$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'android-publish.ps1')
$root = Join-Path (Split-Path $PSScriptRoot -Parent) ('.verification/publish-test-' + [guid]::NewGuid())
$directory = Join-Path $root 'android/app/build/outputs/apk/release'
$null = New-Item -ItemType Directory -Path $directory -Force
@{version='1.2.3';androidVersionCode=10} | ConvertTo-Json | Set-Content (Join-Path $root 'package.json')
$apk = Join-Path $directory 'Budgetly-1.2.3.apk'
'test fixture only' | Set-Content $apk
$manifest = @{version='1.2.3';versionCode=10;packageId='com.flowbudget.app';size=(Get-Item $apk).Length;
    sha256=(Get-FileHash $apk -Algorithm SHA256).Hash.ToLowerInvariant();
    url='https://github.com/Omars64/Budget-Planner/releases/download/v1.2.3/Budgetly-1.2.3.apk'}
$manifest | ConvertTo-Json | Set-Content (Join-Path $directory 'update.json')
$passed = 0
$testSource = ((Get-Content -LiteralPath $PSCommandPath | ForEach-Object { '+' + $_ }) -join "`n")
foreach ($case in @('success','unchanged','check','secret-file','secret-content','release-test-source','push-failure','build-failure','upload-failure','existing-published','draft-retry','bad-hash')) {
    $state = @{Case=$case;Calls=[System.Collections.Generic.List[string]]::new()}
    $runner = {
        param($program,$arguments)
        $call = "$program $($arguments -join ' ')"
        $state.Calls.Add($call)
        $output = ''
        $exitCode = 0
        switch -Wildcard ($call) {
            'git.exe branch*' { $output='main' }
            'git.exe remote*' { $output='https://github.com/Omars64/Budget-Planner.git' }
            'git.exe ls-files*' { $output=if($state.Case -eq 'secret-file'){'.env'}else{'src/App.jsx'} }
            'git.exe diff --cached --name-only' { $output=if($state.Case -eq 'unchanged'){''}else{'src/components/GoogleSignIn.jsx'} }
            'git.exe diff --cached --no-color' {
                if($state.Case -eq 'secret-content'){$output='+GOCSPX-' + '012345678901234567890123'}
                if($state.Case -eq 'release-test-source'){$output=$testSource}
            }
            'git.exe rev-parse*' { $output='abc123' }
            'git.exe push*' { if($state.Case -eq 'push-failure'){$exitCode=1} }
            'gh.exe release list*' { $output=if($state.Case -eq 'existing-published'){'[{"tagName":"v1.2.3","isDraft":false}]'}elseif($state.Case -eq 'draft-retry'){'[{"tagName":"v1.2.3","isDraft":true}]'}else{'[]'} }
            'gh.exe release view*' { $output='{"targetCommitish":"abc123"}' }
            'gh.exe release create*' { if($state.Case -eq 'upload-failure'){$exitCode=1} }
            'powershell.exe*' { if($state.Case -eq 'build-failure' -and $arguments -notcontains '-CheckOnly'){$exitCode=1} }
        }
        [pscustomobject]@{ExitCode=$exitCode;Output=@($output)}
    }.GetNewClosure()
    $manifest.sha256=if($case -eq 'bad-hash'){'bad'}else{(Get-FileHash $apk -Algorithm SHA256).Hash.ToLowerInvariant()}
    $manifest | ConvertTo-Json | Set-Content (Join-Path $directory 'update.json')
    $failed=$false
    try { Invoke-BudgetlyRelease -Root $root -BuildArguments @('build') -Runner $runner -CheckOnly:($case -eq 'check') }
    catch { $failed=$true }
    $shouldFail=$case -in @('secret-file','secret-content','push-failure','build-failure','upload-failure','existing-published','bad-hash')
    if($failed -ne $shouldFail){throw "Unexpected outcome: $case. Calls: $($state.Calls -join '; ')"}
    $calls=$state.Calls -join "`n"
    if($shouldFail -and $calls -match 'release edit'){throw "Published failed case: $case"}
    if($case -eq 'check' -and $calls -match 'git.exe (add|commit|push)|release (create|edit)'){throw 'CheckOnly caused mutations'}
    if($case -eq 'unchanged' -and $calls -match 'git.exe commit'){throw 'Empty commit created'}
    if($case -eq 'success'){
        $push=$state.Calls.FindIndex([Predicate[string]]{param($line)$line -like 'git.exe push*'})
        $build=$state.Calls.FindIndex([Predicate[string]]{param($line)$line -eq 'powershell.exe build'})
        $create=$state.Calls.FindIndex([Predicate[string]]{param($line)$line -like 'gh.exe release create*'})
        $publish=$state.Calls.FindIndex([Predicate[string]]{param($line)$line -like 'gh.exe release edit*'})
        if(!($push -lt $build -and $build -lt $create -and $create -lt $publish)){throw 'Incorrect release order'}
        if($calls -notmatch 'commit -m Budgetly 1.2.3: update authentication'){throw 'Automatic message missing'}
        if($calls -notmatch '--draft' -or $calls -notmatch '--draft=false --latest'){throw 'Draft publication guard missing'}
    }
    if($case -eq 'draft-retry' -and ($calls -notmatch 'release upload' -or $calls -match 'release create')){throw 'Draft retry failed'}
    $passed++
}
Write-Host "$passed release workflow tests passed. All Git/GitHub/build commands were mocked; nothing was pushed or published."
