param([string]$BaseUrl = 'https://budget-planner-ecru-seven.vercel.app')
$ErrorActionPreference = 'Stop'
if (-not $env:FLOWBUDGET_ADMIN_PASSWORD) { throw 'Set FLOWBUDGET_ADMIN_PASSWORD before running.' }
function Request-Api($Method, $Path, $Token, $Body = $null, $Expected = 200) {
    $arguments = @{ Uri = "$BaseUrl$Path"; Method = $Method; SkipHttpErrorCheck = $true; TimeoutSec = 40 }
    if ($Token) { $arguments.Headers = @{ Authorization = "Bearer $Token" } }
    if ($null -ne $Body) { $arguments.ContentType = 'application/json'; $arguments.Body = $Body | ConvertTo-Json -Depth 10 }
    $response = Invoke-WebRequest @arguments
    if ($response.StatusCode -ne $Expected) { throw "$Method $Path returned $($response.StatusCode), expected $Expected" }
    if ($response.Content) { return $response.Content | ConvertFrom-Json }
}
$admin = Request-Api POST '/api/auth/login' '' @{ email = 'omarsolanki46@gmail.com'; password = $env:FLOWBUDGET_ADMIN_PASSWORD }
$suffix = [guid]::NewGuid().ToString('N')
$password = [guid]::NewGuid().ToString('N') + '!aA9'
$createdIds = [System.Collections.Generic.List[int]]::new()
try {
    $ownerEmail = "smoke-owner-$suffix@example.com"
    $memberEmail = "smoke-member-$suffix@example.com"
    $owner = Request-Api POST '/api/admin/users' $admin.token @{ username = 'Temporary verification owner'; email = $ownerEmail; password = $password } 201
    $createdIds.Add($owner.id)
    $ownerAuth = Request-Api POST '/api/auth/login' '' @{ email = $ownerEmail; password = $password }
    $wallet = @(Request-Api GET '/api/wallets' $ownerAuth.token)[0]
    $share = Request-Api POST "/api/shared/wallets/$($wallet.id)/shares" $ownerAuth.token @{ email = $memberEmail; permission = 'edit' } 201
    if ($share.registered) { throw 'Invitation should remain pending until the user exists.' }
    $member = Request-Api POST '/api/admin/users' $admin.token @{ username = 'Temporary verification member'; email = $memberEmail; password = $password } 201
    $createdIds.Add($member.id)
    $memberAuth = Request-Api POST '/api/auth/login' '' @{ email = $memberEmail; password = $password }
    $visible = @(Request-Api GET '/api/shared/wallets' $memberAuth.token)
    if (-not ($visible | Where-Object { $_.wallet_id -eq $wallet.id -and $_.can_edit })) { throw 'Pending invitation did not attach to the member.' }
    $null = Request-Api GET '/api/admin/users' $memberAuth.token $null 403
    $payload = @{ type = 'expense'; amount = 1.125; description = 'Temporary collaboration verification'; wallet_id = $wallet.id; date = (Get-Date).ToString('s') }
    $transaction = Request-Api POST '/api/shared/transactions' $memberAuth.token $payload 201
    $payload.amount = 2.250
    $null = Request-Api PUT "/api/shared/transactions/$($transaction.id)" $ownerAuth.token $payload
    $rows = @(Request-Api GET '/api/shared/transactions' $memberAuth.token)
    if (-not ($rows | Where-Object { $_.id -eq $transaction.id -and $_.amount -eq 2.250 })) { throw 'Owner update did not reach the collaborator.' }
    foreach ($path in @('/api/dashboard', '/api/categories', '/api/budgets', '/api/goals', '/api/debts', '/api/settings', '/api/analytics')) {
        $null = Request-Api GET $path $ownerAuth.token
    }
    Write-Output 'PASS: login, pending invitation, shared edits, role isolation, main app APIs.'
    Write-Output 'Checking persistence after 130 seconds...'
    Start-Sleep -Seconds 130
    $memberAuth = Request-Api POST '/api/auth/login' '' @{ email = $memberEmail; password = $password }
    $rows = @(Request-Api GET '/api/shared/transactions' $memberAuth.token)
    if (-not ($rows | Where-Object { $_.id -eq $transaction.id })) { throw 'Shared transaction disappeared.' }
    Write-Output 'PASS: accounts, invitations and transactions persist beyond two minutes.'
    $null = Request-Api POST "/api/shared/wallets/$($wallet.id)/shares" $ownerAuth.token @{ email = $memberEmail; permission = 'view' } 201
    $null = Request-Api PUT "/api/shared/transactions/$($transaction.id)" $memberAuth.token $payload 403
    $null = Request-Api DELETE "/api/shared/transactions/$($transaction.id)" $memberAuth.token $null 403
    $null = Request-Api DELETE "/api/shared/shares/$($share.id)" $ownerAuth.token $null 204
    $rows = @(Request-Api GET '/api/shared/transactions' $memberAuth.token)
    if ($rows | Where-Object { $_.id -eq $transaction.id }) { throw 'Revoked transaction is still visible.' }
    $null = Request-Api DELETE "/api/admin/users/$($member.id)" $admin.token $null 204
    $createdIds.Remove($member.id) | Out-Null
    $null = Request-Api GET '/api/auth/me' $memberAuth.token $null 401
    Write-Output 'PASS: view-only access, revocation, user deletion and session invalidation.'
} finally {
    foreach ($id in $createdIds) {
        $null = Request-Api DELETE "/api/admin/users/$id" $admin.token $null 204
    }
    Write-Output 'Temporary verification accounts and their data removed.'
}
