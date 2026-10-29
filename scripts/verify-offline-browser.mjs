// CI only. Never import application modules or inject auth/queue records.
import { chromium, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

if (process.env.CI !== 'true') throw new Error('Browser automation is restricted to CI')
const origin = 'http://127.0.0.1:8765'
const server = spawn('python', ['scripts/browser-reliability-server.py'], { stdio: 'ignore' })
let serverError
const serverExited = new Promise(resolve => {
  server.once('exit', resolve)
  server.once('error', error => { serverError = error; resolve() })
})
let browser
let page
let stage = 'startup'
const pageFailures = []
const failedAssetPaths = []
try {
  let ready = false
  for (let attempt = 0; attempt < 120; attempt++) {
    if (serverError || server.exitCode !== null) throw new Error('Synthetic backend exited before readiness')
    try {
      const response = await fetch(`${origin}/__browser_reliability__/ready`, { signal: AbortSignal.timeout(1000) })
      const state = response.ok ? await response.json() : null
      ready = state?.synthetic === true && state.pid === server.pid
    } catch { /* Starting. */ }
    if (ready) break
    await delay(500)
  }
  if (!ready) throw new Error('Synthetic backend readiness timed out')
  browser = await chromium.launch()
  const context = await browser.newContext({ serviceWorkers: 'allow', viewport: { width: 1440, height: 1000 } })
  // Observe service-worker requests too; routing does not cover every worker fetch.
  const cdp = await browser.newBrowserCDPSession()
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'deny' })
  const external = []
  context.on('request', request => {
    const url = new URL(request.url())
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== origin) external.push(url.origin)
  })
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    return url.origin === origin ? route.continue() : route.abort()
  })
  page = await context.newPage()
  page.on('pageerror', error => pageFailures.push(error.message.slice(0, 300)))
  page.on('requestfailed', request => {
    const path = new URL(request.url()).pathname
    if (/\.(js|css)$/.test(path)) failedAssetPaths.push(path)
  })
  page.setDefaultTimeout(15000)
  page.setDefaultNavigationTimeout(30000)
  const login = async suffix => {
    await page.getByLabel('Email', { exact: true }).fill(`browser-${suffix}@example.test`)
    await page.getByLabel('Password', { exact: true }).fill('Synthetic-CI-only-928!')
    const response = page.waitForResponse(r => r.url() === `${origin}/api/auth/login` && r.request().method() === 'POST')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    expect((await response).status()).toBe(200)
    await expect(page.locator('.signout-button')).toBeVisible()
  }
  const records = () => page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('budgetly-offline-v1', 1)
    request.onerror = () => reject(new Error('IndexedDB unavailable'))
    request.onsuccess = () => {
      const db = request.result
      const read = db.transaction('records').objectStore('records').getAll()
      read.onsuccess = () => { resolve(read.result); db.close() }
      read.onerror = () => { db.close(); reject(new Error('IndexedDB read failed')) }
    }
  }))
  const queued = async marker => (await records()).filter(row => row.description === marker && row.key)
  const marker = 'CI offline persisted A'
  stage = 'initial sign-in'
  await page.goto(origin)
  await login('a')
  await page.goto(`${origin}/#/transactions`)
  await expect.poll(async () => (await records()).some(row => row.user?.email === 'browser-a@example.test' && row.fingerprint)).toBeTruthy()
  await page.evaluate(async () => {
    await Promise.race([
      (async () => {
        await navigator.serviceWorker.ready
        if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }))
      })(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Offline worker readiness timed out')), 15000)),
    ])
  })
  // Exercise notification preference delivery and re-registration without
  // requesting notification permission or contacting a push subscription service.
  for (const enabled of [false, true, false]) {
    await page.evaluate(async enabled => {
      const registration = await navigator.serviceWorker.register('/budgetly-push-sw.js', { scope: '/' })
      await navigator.serviceWorker.ready
      if (!registration.active) throw new Error('Combined worker is not active')
      await new Promise((resolve, reject) => {
        const channel = new MessageChannel()
        const timer = setTimeout(() => reject(new Error('Worker preference acknowledgment timed out')), 10000)
        channel.port1.onmessage = event => {
          clearTimeout(timer)
          channel.port1.close()
          event.data?.saved ? resolve() : reject(new Error('Worker did not save preferences'))
        }
        registration.active.postMessage({ type: 'budgetly-update-preference', enabled, scheduled: false, upcoming: false }, [channel.port2])
      })
    }, enabled)
    const worker = context.serviceWorkers().find(worker => worker.url() === `${origin}/budgetly-push-sw.js`)
    expect(worker).toBeTruthy()
    expect(await worker.evaluate(async () => {
      const tasks = []
      const event = new Event('push')
      Object.defineProperties(event, {
        data: { value: { json: () => ({ version: 'invalid-synthetic-version' }) } },
        waitUntil: { value: promise => tasks.push(promise) },
      })
      self.dispatchEvent(event)
      await Promise.all(tasks)
      return tasks.length
    })).toBeGreaterThan(0)
  }
  await page.locator('.add-button').click()
  const dialog = page.getByRole('dialog', { name: 'Add transaction' })
  await expect(dialog.getByRole('button', { name: 'Add transaction', exact: true })).toBeEnabled()
  await dialog.getByLabel(/Amount/).fill('12.345')
  await dialog.getByLabel('Description', { exact: true }).fill(marker)
  await context.setOffline(true)
  await dialog.getByRole('button', { name: 'Add transaction', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect.poll(async () => (await queued(marker)).length).toBe(1)
  const before = (await queued(marker))[0]
  stage = 'offline reopening'
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.locator('.signout-button')).toBeVisible()
  await expect.poll(async () => (await queued(marker)).length).toBe(1)
  expect((await queued(marker))[0]).toEqual(before)
  await expect(page.getByText(marker, { exact: true }).first()).toBeVisible()
  let committed = false
  let interceptionFailure
  const replayKeys = []
  const loseFirstResponse = async route => {
    const request = route.request()
    if (request.method() !== 'POST' || request.postDataJSON()?.description !== marker) {
      await route.fallback()
      return
    }
    replayKeys.push(request.headers()['idempotency-key'])
    if (replayKeys.length > 1) {
      await route.continue()
      return
    }
    try {
      // The real API commits before returning success. Never fulfill this response
      // to the page: model a committed write whose acknowledgment was lost.
      const response = await route.fetch({ timeout: 15000, maxRetries: 0, maxRedirects: 0 })
      expect(response.ok()).toBe(true)
      await response.dispose()
      await context.setOffline(true)
      await route.abort('connectionfailed')
      committed = true
    } catch (error) {
      interceptionFailure = error
      await route.abort().catch(() => {})
    }
  }
  await context.route(`${origin}/api/transactions*`, loseFirstResponse)
  await page.evaluate(() => {
    window.__reliabilitySyncFinished = false
    window.addEventListener('budgetly:sync-state', event => {
      if (!event.detail.syncing) window.__reliabilitySyncFinished = true
    })
  })
  const lostResponse = page.waitForEvent('requestfailed', {
    predicate: request => request.method() === 'POST' && request.url().startsWith(`${origin}/api/transactions`) && request.postDataJSON()?.description === marker,
    timeout: 20000,
  })
  await context.setOffline(false)
  // Attach the rejection handler immediately while waiting for route.fetch.
  await Promise.all([
    lostResponse,
    expect.poll(() => {
      if (interceptionFailure) throw interceptionFailure
      return committed
    }, { timeout: 20000 }).toBe(true),
  ])
  await page.waitForFunction(() => window.__reliabilitySyncFinished)
  const uncertain = await queued(marker)
  expect(uncertain).toHaveLength(1)
  expect(uncertain[0].id).toBe(before.id)
  expect(uncertain[0].key).toBe(before.key)
  expect(uncertain[0].attempted).toBe(true)
  expect(replayKeys).toEqual([before.key])
  // APIRequestContext stays online independently of browser emulation. This
  // read proves server commit while the browser still holds its uncertain row.
  const token = await page.evaluate(() => sessionStorage.getItem('flowbudget_token') || localStorage.getItem('flowbudget_token'))
  const committedLedger = await context.request.get(`${origin}/api/transactions`, {
    headers: { Authorization: `Bearer ${token}` }, timeout: 10000, maxRedirects: 0,
  })
  expect(committedLedger.ok()).toBe(true)
  const committedRows = (await committedLedger.json()).filter(row => row.description === marker)
  expect(committedRows).toHaveLength(1)
  await committedLedger.dispose()
  await context.setOffline(false)
  await expect.poll(async () => (await queued(marker)).length, { timeout: 30000 }).toBe(0)
  expect(replayKeys).toEqual([before.key, before.key])
  await context.unroute(`${origin}/api/transactions*`, loseFirstResponse)
  const transactions = () => page.evaluate(async () => {
    const token = sessionStorage.getItem('flowbudget_token') || localStorage.getItem('flowbudget_token')
    const response = await fetch('/api/transactions', { headers: { Authorization: `Bearer ${token}` } })
    if (!response.ok) throw new Error('Authenticated ledger read failed')
    return response.json()
  })
  const matching = async () => (await transactions()).filter(row => row.description === marker)
  await expect.poll(async () => (await matching()).length).toBe(1)
  expect((await matching())[0].id).toBe(committedRows[0].id)
  // Repeat reconnect and a full reload to catch accidental queue replay.
  await context.setOffline(true)
  await context.setOffline(false)
  await page.reload()
  await expect(page.locator('.signout-button')).toBeVisible()
  expect(await matching()).toHaveLength(1)
  // Leave another A entry pending during the account switch. B must never
  // display or submit it, even though A's durable record remains on the device.
  const pendingMarker = 'CI pending A account isolation'
  await page.locator('.add-button').click()
  await expect(dialog.getByRole('button', { name: 'Add transaction', exact: true })).toBeEnabled()
  await dialog.getByLabel(/Amount/).fill('7.123')
  await dialog.getByLabel('Description', { exact: true }).fill(pendingMarker)
  await context.setOffline(true)
  await dialog.getByRole('button', { name: 'Add transaction', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect.poll(async () => (await queued(pendingMarker)).length).toBe(1)
  await page.locator('.signout-button').click()
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible()
  await context.setOffline(false)
  await login('b')
  await page.goto(`${origin}/#/transactions`)
  await expect(page.locator('.signout-button')).toBeVisible()
  await expect.poll(async () => (await records()).some(row => row.user?.email === 'browser-b@example.test' && row.fingerprint)).toBeTruthy()
  expect(await transactions()).toEqual([])
  await expect(page.getByText(marker, { exact: true })).toHaveCount(0)
  await expect(page.getByText(pendingMarker, { exact: true })).toHaveCount(0)
  await context.setOffline(true)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.locator('.signout-button')).toBeVisible()
  await expect(page.getByText(marker, { exact: true })).toHaveCount(0)
  await expect(page.getByText(pendingMarker, { exact: true })).toHaveCount(0)
  expect(external).toEqual([])
  console.log('PASS: real sign-in, offline IndexedDB reload, exactly-once reconnect, account isolation')
} catch (error) {
  // Only fixed metadata from the isolated synthetic origin. Never log tokens,
  // session contents, network headers or ledger payloads.
  const state = await page?.evaluate(() => ({
    online: navigator.onLine,
    tokenPresent: Boolean(sessionStorage.getItem('flowbudget_token') || localStorage.getItem('flowbudget_token')),
    offlineAccountPresent: Boolean(localStorage.getItem('budgetly_offline_user')),
    rootChildren: document.querySelector('#root')?.childElementCount,
    appLoading: Boolean(document.querySelector('.app-loading')),
    headings: [...document.querySelectorAll('h1,h2,h3,[role="status"],[role="alert"]')].map(element => element.textContent).slice(0, 12),
  })).catch(() => ({ unavailable: true }))
  console.error('Synthetic browser failure:', JSON.stringify({ stage, state, pageFailures, failedAssetPaths }))
  throw error
} finally {
  try { await browser?.close() }
  finally {
    if (server.exitCode === null && !serverError) {
      server.kill('SIGTERM')
      await Promise.race([serverExited, delay(5000, undefined, { ref: false })])
      if (server.exitCode === null && server.signalCode === null) {
        server.kill('SIGKILL')
        await serverExited
      }
    }
  }
}
