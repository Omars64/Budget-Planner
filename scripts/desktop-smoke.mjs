import { _electron } from '@playwright/test'
import { resolve } from 'node:path'

const exe = resolve('dist-desktop/win-unpacked/Budgetly.exe')
console.log('Launching packaged desktop app')
const app = await _electron.launch({ executablePath: exe, timeout: 30000 })
try {
  console.log('Waiting for first window')
  const page = await app.firstWindow()
  console.log('Window opened:', page.url())
  await page.getByText('A little clarity.').waitFor({ timeout: 20000 })
  const logo = await page.locator('link[rel="icon"]').getAttribute('href')
  if (!logo?.includes('/brand/wallet-')) throw new Error('Windows app favicon is not the wallet logo.')
  const desktop = await page.evaluate(() => window.budgetlyDesktop?.version)
  if (!desktop) throw new Error('Packaged desktop identity missing.')
  const apiStatus = await page.evaluate(async () => { try { return (await fetch('/api/app-updates/web', { cache: 'no-store' })).status } catch { return 0 } })
  if (apiStatus !== 200) throw new Error(`Packaged app could not reach the production API (status ${apiStatus}).`)
  console.log(`Windows app launched from bundled UI: Budgetly ${desktop}, wallet favicon ${logo}`)
} finally {
  await app.close()
}
