const { app, ipcMain } = require('electron')
const { createWriteStream } = require('node:fs')
const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { spawn } = require('node:child_process')
const { Readable, Transform } = require('node:stream')
const { pipeline } = require('node:stream/promises')
const { windowsPublisher, windowsInstallScope } = require('./windows-signature.cjs')

const installerHosts = new Set(['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'])
const versionPattern = /^\d{1,8}\.\d{1,8}\.\d{1,8}$/

function newerVersion(candidate, installed) {
  if (!versionPattern.test(candidate) || !versionPattern.test(installed)) return false
  const next = candidate.split('.').map(Number), current = installed.split('.').map(Number)
  const index = next.findIndex((part, i) => part !== current[i])
  return index >= 0 && next[index] > current[index]
}

function officialInstaller(version) {
  return `https://github.com/Omars64/Budget-Planner/releases/download/v${version}/Budgetly-Setup-${version}.exe`
}

async function releaseFor(origin, version, signal) {
  const reply = await fetch(`${origin}/api/app-updates/windows`, { signal, cache:'no-store', redirect:'error' })
  if (!reply.ok || !reply.body) throw new Error('The latest Windows release could not be checked.')
  const chunks = []
  let length = 0
  for await (const chunk of reply.body) {
    length += chunk.byteLength
    if (length > 4096) throw new Error('The Windows update information is too large.')
    chunks.push(chunk)
  }
  const data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (data.schema !== 1 || data.version !== version || data.url !== officialInstaller(version) || data.signed !== true ||
      !Number.isSafeInteger(data.size) || data.size < 1000000 || data.size > 536870912 || !/^[a-f0-9]{64}$/.test(data.sha256)) {
    throw new Error('This release is no longer current or is missing verified Windows release information.')
  }
  return data
}

async function downloadInstaller(release, file, signal) {
  let url = new URL(release.url)
  for (let attempt = 0; attempt < 6; attempt++) {
    if (url.protocol !== 'https:' || !installerHosts.has(url.hostname) || url.port || url.username || url.password) {
      throw new Error('The installer was redirected outside the official release host.')
    }
    const reply = await fetch(url.href, { signal, redirect:'manual' })
    if ([301, 302, 303, 307, 308].includes(reply.status)) {
      const location = reply.headers.get('location')
      await reply.body?.cancel()
      if (!location) break
      url = new URL(location, url)
      continue
    }
    if (!reply.ok || !reply.body) throw new Error('The Windows installer could not be downloaded.')
    const hash = createHash('sha256')
    let bytes = 0
    const verify = new Transform({
      transform(chunk, encoding, done) {
        bytes += chunk.length
        if (bytes > release.size) return done(new Error('The Windows installer exceeds its published size.'))
        hash.update(chunk)
        done(null, chunk)
      },
    })
    await pipeline(Readable.fromWeb(reply.body), verify, createWriteStream(file, { flags:'wx' }), { signal })
    if (bytes !== release.size || hash.digest('hex') !== release.sha256) throw new Error('The Windows installer did not match its published checksum.')
    return
  }
  throw new Error('The Windows installer could not be reached.')
}

function registerWindowsUpdates(origin, trustedSender) {
  const directory = path.join(app.getPath('userData'), 'verified-update')
  const file = path.join(directory, 'Budgetly-Setup.exe')
  const cleanup = () => fs.unlink(file).catch(() => {})
  const startupCleanup = app.isPackaged ? cleanup() : Promise.resolve()
  let installIdentity
  const installedIdentity = () => {
    if (!app.isPackaged || process.platform !== 'win32') return Promise.resolve(null)
    installIdentity ??= Promise.all([windowsPublisher(process.execPath), windowsInstallScope(process.execPath)])
      .then(([publisher, scope]) => publisher && ['user', 'machine'].includes(scope) ? { publisher, scope } : null)
      .catch(() => null)
    return installIdentity
  }
  let installing = false
  ipcMain.handle('budgetly:can-install-update', async event => trustedSender(event) && Boolean(await installedIdentity()))
  ipcMain.handle('budgetly:install-update', async (event, version) => {
    if (!trustedSender(event) || typeof version !== 'string' || !newerVersion(version, app.getVersion()) || installing) {
      return { error:'The Windows update could not be started.' }
    }
    installing = true
    try {
      const identity = await installedIdentity()
      if (!identity) throw new Error('Install the first signed Budgetly version from the website to enable in-app updates.')
      const signal = AbortSignal.timeout(600000)
      const release = await releaseFor(origin, version, signal)
      await startupCleanup
      await fs.mkdir(directory, { recursive:true })
      await downloadInstaller(release, file, signal)
      if (await windowsPublisher(file) !== identity.publisher) throw new Error('Windows could not verify the installer against the installed publisher.')
      if (!trustedSender(event)) throw new Error('Open Budgetly to continue with the update.')
      const scope = identity.scope === 'machine' ? '/allusers' : '/currentuser'
      const installer = spawn(file, ['/S', scope, '--updated', '--force-run'], { detached:true, stdio:'ignore', windowsHide:true })
      await new Promise((resolve, reject) => installer.once('spawn', resolve).once('error', reject))
      installer.unref()
      app.quit()
      return { installing:true }
    } catch (failure) {
      await cleanup()
      installing = false
      return { error:failure.message || 'Could not install the Windows update.' }
    }
  })
}

module.exports = { registerWindowsUpdates }
