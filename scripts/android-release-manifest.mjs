import { readFile, writeFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const directory = join(root, 'android/app/build/outputs/apk/release')
const metadata = JSON.parse(await readFile(join(directory, 'output-metadata.json'), 'utf8'))
const build = metadata.elements?.[0]
if (metadata.applicationId !== 'com.flowbudget.app' || build?.versionCode !== pkg.androidVersionCode || build?.versionName !== pkg.version) {
  throw new Error('Release APK metadata does not match package.json. Build the current signed release first.')
}
const apk = join(directory, `Budgetly-${pkg.version}.apk`)
const size = (await stat(apk)).size
if (size <= 0 || size > 268435456) throw new Error('Release APK size is outside the allowed range.')
const original = await readFile(join(directory, build.outputFile))
const bytes = await readFile(apk)
if (!bytes.equals(original)) throw new Error('Named APK differs from the latest Gradle release output. Rebuild it.')
const manifest = { schema: 1, packageId: metadata.applicationId, version: pkg.version, versionCode: pkg.androidVersionCode,
  size, sha256: createHash('sha256').update(bytes).digest('hex'),
  url: `https://github.com/Omars64/Budget-Planner/releases/download/v${pkg.version}/${basename(apk)}` }
const output = join(directory, 'update.json')
await writeFile(output, JSON.stringify(manifest, null, 2) + '\n')
console.log(`Release manifest: ${output}\nPublish it alongside ${apk} in GitHub release v${pkg.version}.`)
