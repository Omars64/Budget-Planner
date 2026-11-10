import { readFile, writeFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, join } from 'node:path'
import signature from '../desktop/windows-signature.cjs'

const root = resolve(import.meta.dirname, '..')
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const directory = join(root, 'dist-desktop')
const exe = join(directory, `Budgetly-Setup-${pkg.version}.exe`)
const size = (await stat(exe)).size
if (size < 1000000 || size > 536870912) throw new Error('Unexpected Windows installer size')
const sha256 = createHash('sha256').update(await readFile(exe)).digest('hex')
const appPath = join(directory, 'win-unpacked', 'Budgetly.exe')
const [installerPublisher, appPublisher] = await Promise.all([exe, appPath].map(file => signature.windowsPublisher(file).catch(() => null)))
const signed = Boolean(installerPublisher && installerPublisher === appPublisher)
if (!signed) {
  const message = 'Windows publisher is unverified. In-app updates require the installer and packaged app to share a trusted Authenticode signature.'
  if (process.env.BUDGETLY_REQUIRE_WINDOWS_SIGNING === '1') throw new Error(message)
  console.warn(message)
}
const manifest = { schema: 1, version: pkg.version, size, sha256, signed,
  url: `https://github.com/Omars64/Budget-Planner/releases/download/v${pkg.version}/Budgetly-Setup-${pkg.version}.exe` }
await writeFile(join(directory, 'windows-update.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(`Windows installer: ${exe} (${size} bytes, SHA-256 ${sha256})`)
