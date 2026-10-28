// Exercise built worker behavior without a browser, network or account records.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

const source = await readFile(new URL('../dist/budgetly-push-sw.js', import.meta.url), 'utf8')
const legacy = await readFile(new URL('../dist/sw.js', import.meta.url), 'utf8')
for (const entry of [source, legacy]) {
  const handlers = new Map()
  const notifications = []
  const shell = { syntheticShell: true }
  const self = {
    location: { origin: 'https://synthetic.invalid' },
    addEventListener(type, callback) {
      handlers.set(type, [...(handlers.get(type) || []), callback])
    },
    caches: { open: async () => ({ match: async () => undefined }) },
    registration: { showNotification: async (...args) => notifications.push(args) },
  }
  const context = { self, URL, Response,
    caches: { match: async path => path === '/index.html' ? shell : undefined },
    fetch: async () => { throw new Error('Synthetic offline network') },
    importScripts(path) {
      assert.equal(path, '/budgetly-push-sw.js')
      runInNewContext(source, context)
    },
  }
  runInNewContext(entry, context)
  assert.ok(handlers.has('push'), 'Push handler survives offline registration')
  assert.ok(handlers.has('message'), 'Notification preferences survive offline registration')
  assert.ok(handlers.has('fetch'), 'Offline handler survives push registration')
  let response
  for (const callback of handlers.get('fetch')) callback({
    request: { method: 'GET', url: 'https://synthetic.invalid/', mode: 'navigate' },
    respondWith(value) { response = value },
  })
  assert.equal(await response, shell, 'Offline navigation uses the cached shell')
  let cachedFinancialRequest = false
  for (const callback of handlers.get('fetch')) callback({
    request: { method: 'GET', url: 'https://synthetic.invalid/api/transactions', mode: 'cors' },
    respondWith() { cachedFinancialRequest = true },
  })
  assert.equal(cachedFinancialRequest, false, 'Worker never intercepts financial API reads')
  const tasks = []
  for (const callback of handlers.get('push')) callback({
    data: { json: () => ({ version: '6.5.6' }) },
    waitUntil(task) { tasks.push(task) },
  })
  await Promise.all(tasks)
  assert.equal(notifications.length, 1, 'Update push still displays a notification')
}
console.log('PASS: canonical and legacy workers support offline navigation and push; API reads stay uncached')
