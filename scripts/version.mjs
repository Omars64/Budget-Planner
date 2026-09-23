import { readFile, writeFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const read = path => readFile(new URL(path, root), 'utf8')
const pkg = JSON.parse(await read('package.json'))
if (!/^\d+\.\d+\.\d+$/.test(pkg.version) || !Number.isInteger(pkg.androidVersionCode) || pkg.androidVersionCode <= 0) throw new Error('Set a semantic version and positive androidVersionCode in package.json.')
const generated = `# Generated from package.json by npm run version:sync.\nVERSION = "${pkg.version}"\n`
const lock = JSON.parse(await read('package-lock.json'))
if (process.argv.includes('--check')) {
  if ((await read('api/_version.py')).replaceAll('\r\n', '\n') !== generated || lock.version !== pkg.version || lock.packages[''].version !== pkg.version) throw new Error('Version mismatch. Run npm run version:sync and commit the generated files.')
  console.log(`Budgetly ${pkg.version}, Android ${pkg.androidVersionCode}: consistent`)
} else {
  lock.version = pkg.version
  lock.packages[''].version = pkg.version
  await writeFile(new URL('api/_version.py', root), generated)
  await writeFile(new URL('package-lock.json', root), JSON.stringify(lock, null, 2) + '\n')
  console.log(`Synced Budgetly ${pkg.version}, Android ${pkg.androidVersionCode}`)
}
