// @vitest-environment node
// Opt in with FLOWBUDGET_PLAYWRIGHT pointing to an installed Playwright module.
// CI: FLOWBUDGET_PLAYWRIGHT=@playwright/test FLOWBUDGET_BROWSER_CHANNEL=chromium
// npm test -- --run src/lib/offlineStore.test.js
// Without the opt-in, ordinary unit runs skip these browser tests. Once opted
// in, missing packages/browsers fail the suite rather than silently skipping.
// Uses a fresh browser context and intercepted synthetic origin; no API server.
import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
const playwrightPath = process.env.FLOWBUDGET_PLAYWRIGHT
const browserTests = playwrightPath ? describe : describe.skip
browserTests('real IndexedDB queue coordination across tabs', () => {
  let browser, context, first, second
  beforeAll(async () => {
    const { chromium } = await import(playwrightPath)
    browser = await chromium.launch({headless:true, channel:process.env.FLOWBUDGET_BROWSER_CHANNEL || (process.env.CI ? 'chromium' : 'msedge')})
  }, 30000)
  afterAll(async () => { await browser?.close() })
  beforeEach(async () => {
    const store = await readFile(new URL('./offlineStore.js', import.meta.url), 'utf8')
    const sync = (await readFile(new URL('./offlineSync.js', import.meta.url), 'utf8')).replace("'./offlineStore'", "'./offlineStore.js'")
    context = await browser.newContext()
    await context.route('**/*', route => {
      const path = new URL(route.request().url()).pathname
      return route.fulfill({contentType:path.endsWith('.js')?'text/javascript':'text/html',body:path==='/offlineStore.js'?store:path==='/offlineSync.js'?sync:'<!doctype html><title>Synthetic offline test</title>'})
    })
    first = await context.newPage()
    second = await context.newPage()
    for (const page of [first,second]) {
      await page.goto('http://budgetly.test')
      await page.evaluate(`(async () => {
        window.store = await import('/offlineStore.js');
        window.queue = await import('/offlineSync.js');
        window.queue.setOfflineUser(4);
      })()`)
    }
  })
  afterEach(async () => { await context?.close() })
  const seed = async ids => first.evaluate(async ids => {
    for (const id of ids) await window.store.writeOffline(`queue:4:${id}`, {
      id,key:`original-${id}`,path:'/api/transactions?space_id=personal',body:JSON.stringify({description:id}),
      status:'pending',attempted:false,createdAt:id==='a'?1:2,
    })
  }, ids)

  it('another tab can discard a later snapshot entry without it being posted', async () => {
    await seed(['a','b'])
    await first.evaluate(() => {
      window.sent=[]
      window.running=window.queue.syncOfflineQueue(async (_path,options) => {
        window.sent.push(JSON.parse(options.body).description)
        await new Promise(resolve=>{window.release=resolve})
      },'synthetic',4)
    })
    await first.waitForFunction(()=>window.sent.length===1)
    await second.evaluate(()=>window.queue.discardOfflineTransaction('b',4))
    await first.evaluate(async()=>{window.release();await window.running})
    expect(await first.evaluate(()=>window.sent)).toEqual(['a'])
    expect(await second.evaluate(()=>window.queue.listOfflineQueue(4))).toEqual([])
  })

  it('an in-flight claim rejects discard in another tab and preserves the original retry key after a lost response', async () => {
    await seed(['a'])
    await first.evaluate(()=>{
      window.running=window.queue.syncOfflineQueue(async()=>{
        await new Promise(resolve=>{window.release=resolve})
        throw Object.assign(new Error('Committed but response lost'),{network:true})
      },'synthetic',4)
    })
    await first.waitForFunction(()=>Boolean(window.release))
    const refusal=await second.evaluate(async()=>{
      try {await window.queue.discardOfflineTransaction('a',4);return 'discarded'} catch(error){return error.message}
    })
    expect(refusal).toContain('may already have reached')
    await first.evaluate(async()=>{window.release();await window.running})
    // Simulate reloading the sending tab: attempt history must survive JS state.
    await first.reload()
    const result=await second.evaluate(async()=>{
      const rows=await window.queue.listOfflineQueue(4)
      let key
      await window.queue.syncOfflineQueue(async(_path,options)=>{key=options.headers.get('Idempotency-Key')},'synthetic',4)
      return {attempted:rows[0].attempted,key,remaining:await window.queue.listOfflineQueue(4)}
    })
    expect(result).toEqual({attempted:true,key:'original-a',remaining:[]})
  })

  it('discard winning the storage transaction prevents either tab from sending',async()=>{
    await seed(['a'])
    await second.evaluate(()=>window.queue.discardOfflineTransaction('a',4))
    for (const page of [first,second]) {
      expect(await page.evaluate(async()=>{
        let sends=0
        await window.queue.syncOfflineQueue(async()=>{sends++},'synthetic',4)
        return sends
      })).toBe(0)
    }
  })

  it('an aborted atomic update leaves the entry intact and missing entries stay missing',async()=>{
    await seed(['a'])
    const result=await second.evaluate(async()=>{
      try {await window.store.updateOffline('queue:4:a',()=>{throw new Error('refused')})} catch { /* expected abort */ }
      await window.queue.retryOfflineTransaction('missing',4)
      return {row:await window.store.readOffline('queue:4:a'),missing:await window.store.readOffline('queue:4:missing')}
    })
    expect(result.row.attempted).toBe(false)
    expect(result.missing).toBeUndefined()
  })
})

