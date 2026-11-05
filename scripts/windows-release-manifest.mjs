import { readFile, writeFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, join } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const directory = join(root, 'dist-desktop')
const exe = join(directory, `Budgetly-Setup-${pkg.version}.exe`)
const size = (await stat(exe)).size
if (size < 1000000 || size > 536870912) throw new Error('Unexpected Windows installer size')
const sha256 = createHash('sha256').update(await readFile(exe)).digest('hex')
const manifest = { schema: 1, version: pkg.version, size, sha256,
  url: `https://github.com/Omars64/Budget-Planner/releases/download/v${pkg.version}/Budgetly-Setup-${pkg.version}.exe` }
await writeFile(join(directory, 'windows-update.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(`Windows installer: ${exe} (${size} bytes, SHA-256 ${sha256})`)
