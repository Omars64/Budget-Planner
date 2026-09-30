const { chromium, request } = require(process.env.FLOWBUDGET_PLAYWRIGHT || 'playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs')

async function main() {
  const base = 'http://127.0.0.1:5173'
  const client = await request.newContext({ baseURL: base })
  const login = await client.post('/api/auth/login', { data: { email: 'omarsolanki46@gmail.com', password: 'PreviewOnly-2026!' } })
  assert(login.ok(), await login.text())
  const { token } = await login.json()
  const headers = { Authorization: `Bearer ${token}` }
  await client.put('/api/tutorial', { headers, data: { status: 'skipped' } })
  await client.post('/api/feedback/rating', { headers, data: { stars: 5, comment: 'Isolated automated preview account' } })
  for (const [name, color, card_network] of [['Emerald card', '#183d36', 'mastercard'], ['Ocean card', '#32647a', 'visa']]) {
    const result = await client.post('/api/wallets', { headers, data: { name, type: 'bank', color, card_network, initial_balance: 120 } })
    assert(result.ok(), await result.text())
  }
  const note = await client.post('/api/notes', { headers, data: { title: 'Shopping plan', content: 'Milk\nBread\nCoffee', note_type: 'text' } })
  assert(note.ok(), await note.text())
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  fs.mkdirSync('.verification', { recursive: true })
  const errors = []
  try {
    for (const [width, native] of [[1440,false],[390,false],[320,false],[390,true],[320,true]]) for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width, height: 900 } })
      await context.addInitScript(({token,native}) => {
        sessionStorage.setItem('flowbudget_token',token)
        if (native) {
          window.CapacitorCustomPlatform={name:'android'}
          window.Capacitor={PluginHeaders:[{name:'BudgetlyReminders',methods:[{name:'configure',rtype:'promise'}]},{name:'LocalNotifications',methods:[{name:'cancel',rtype:'promise'}]},{name:'BankSms',methods:[{name:'pending',rtype:'promise'}]}],nativePromise:async plugin=>plugin==='BankSms'?{messages:[]}:undefined}
        }
      },{token,native})
      if (native) await context.route('https://budget-planner-ecru-seven.vercel.app/**', async route => {
        const url=new URL(route.request().url())
        const response=await route.fetch({url:base+url.pathname+url.search})
        await route.fulfill({response})
      })
      const page = await context.newPage()
      page.on('pageerror', error => errors.push(error.message))
      await page.goto(base + '/#/wallets')
      await page.getByText('Emerald card', { exact: true }).first().waitFor()
      const skip = page.getByRole('button', { name: 'Skip for now', exact: true })
      if (await skip.isVisible()) await skip.click()
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; document.documentElement.style.setProperty('--text', theme === 'dark' ? '#e4e8e7' : '#172c38') }, theme)
      const card = page.locator('.wallet-card.payment-card').filter({ hasText: 'Emerald card' }).first()
      const style = await card.evaluate(element => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height, background: getComputedStyle(element).backgroundImage }))
      assert(style.background.includes('gradient'), 'Card color must survive the theme')
      assert(await card.evaluate(element => element.style.getPropertyValue('--wallet-card-color')) === '#183d36', 'Saved color must reach the card')
      if (width < 620) assert(style.width > width * .8, 'Mobile card should take the full row')
      assert(style.width / style.height > 1.4, 'Payment card should keep horizontal card proportions')
      await page.screenshot({ path: `.verification/wallets-${width}-${native ? 'android' : 'web'}-${theme}.png`, fullPage: true })
      await page.goto(base + '/#/budgets')
      await page.getByRole('button', { name: 'New budget', exact: true }).click()
      await page.getByLabel('For month').fill('2026-10')
      assert(await page.getByLabel('For month').inputValue() === '2026-10')
      await page.getByRole('button', { name: 'Cancel', exact: true }).click()
      await page.goto(base + '/#/notes')
      await page.getByText('Shopping plan', { exact: true }).first().waitFor()
      await page.screenshot({ path: `.verification/notes-library-${width}-${native ? 'android' : 'web'}-${theme}.png`, fullPage: true })
      await page.getByText('Shopping plan', { exact: true }).first().click()
      await page.getByRole('button', { name: 'Folder and paper settings' }).click()
      const folder = await page.getByLabel('Note folder').boundingBox()
      const paper = await page.getByLabel('Paper style').boundingBox()
      assert(Math.abs(folder.y - paper.y) < 3 && paper.x > folder.x, 'Note settings must share one row')
      await page.getByLabel('Paper style').selectOption('lined')
      await page.getByLabel('Note content').fill('Updated shopping plan')
      await page.waitForFunction(() => document.querySelector('.save-state')?.textContent === 'Saved')
      await page.screenshot({ path: `.verification/notes-${width}-${native ? 'android' : 'web'}-${theme}.png`, fullPage: true })
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No horizontal page overflow')
      await context.close()
    }
    assert.deepEqual(errors, [])
    console.log('Wallet colors/full-width cards, budget month, Notes settings and autosave: passed at 1440/390/320px in both themes')
  } finally { await browser.close(); await client.dispose() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
