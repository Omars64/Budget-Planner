const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const path = require('node:path')

const run = promisify(execFile)

async function windowsCheck(file, script) {
  if (process.platform !== 'win32') return null
  const psHome = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0')
  const command = [
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
    '$ErrorActionPreference = "Stop"',
    ...script,
  ].join('\n')
  const { stdout } = await run(path.join(psHome, 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', command], {
    env: { ...process.env, PSModulePath:path.join(psHome, 'Modules'), BUDGETLY_VERIFY_FILE:file },
    windowsHide:true, timeout:60000, encoding:'utf8',
  })
  return stdout.trim() || null
}

function windowsPublisher(file) {
  return windowsCheck(file, [
    '$signature = Get-AuthenticodeSignature -LiteralPath $env:BUDGETLY_VERIFY_FILE',
    'if ($signature.Status -eq "Valid" -and $signature.SignerCertificate) { $signature.SignerCertificate.Subject }',
  ])
}

function windowsInstallScope(file) {
  // The installer keeps this registry identity across releases.
  const key = 'Software\\50e524d4-9fa7-5b66-ba6c-7066f1dc8e93'
  return windowsCheck(file, [
    '$directory = [IO.Path]::GetDirectoryName($env:BUDGETLY_VERIFY_FILE)',
    `$user = Get-ItemPropertyValue -LiteralPath 'HKCU:\\${key}' -Name InstallLocation -ErrorAction SilentlyContinue`,
    `$machine = Get-ItemPropertyValue -LiteralPath 'HKLM:\\${key}' -Name InstallLocation -ErrorAction SilentlyContinue`,
    'if ($user -eq $directory -and $machine -ne $directory) { "user" }',
    'elseif ($machine -eq $directory -and $user -ne $directory) { "machine" }',
  ])
}

module.exports = { windowsPublisher, windowsInstallScope }
