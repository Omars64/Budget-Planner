import { readdir, readFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'

// Baseline measured from the v6.14.1 production build: index JS 188 KiB gzip,
// index CSS 40 KiB gzip. Leave roughly 15% room for normal feature work.
const limits = { js: 220 * 1024, css: 48 * 1024 }
const assets = await readdir('dist/assets')
for (const extension of ['js', 'css']) {
  const file = assets.find(name => /^index-[\w-]+\./.test(name) && name.endsWith(`.${extension}`))
  if (!file) throw new Error(`Missing production index ${extension} bundle`)
  const bytes = gzipSync(await readFile(`dist/assets/${file}`)).length
  console.log(`Initial ${extension}: ${(bytes / 1024).toFixed(1)} KiB gzip / ${limits[extension] / 1024} KiB budget`)
  if (bytes > limits[extension]) throw new Error(`Initial ${extension} bundle exceeds measured release budget; inspect the bundle before raising the limit.`)
}
