/* Update delivery only: no page caching or financial records. */
const preferenceStore = 'budgetly-push-preference-v1'
self.addEventListener('message', event => {
  if (event.data?.type !== 'budgetly-update-preference') return
  event.waitUntil((async () => {
    const store = await self.caches.open(preferenceStore)
    await store.put('/budgetly-push-enabled', new Response(String(Boolean(event.data.enabled))))
    event.ports[0]?.postMessage({saved:true})
    if (!event.data.enabled) {
      for (const tag of ['budgetly-update', 'budgetly-test']) {
        for (const notice of await self.registration.getNotifications({tag})) notice.close()
      }
    }
  })())
})
self.addEventListener('push', event => {
  event.waitUntil((async () => {
    const store = await self.caches.open(preferenceStore)
    const enabled = await store.match('/budgetly-push-enabled')
    if (enabled && await enabled.text() === 'false') return
    let data
    try { data = event.data.json() } catch { return }
    if (!/^\d+\.\d+\.\d+$/.test(data.version)) return
    await self.registration.showNotification(data.test === true ? 'Budgetly test notification' : `Budgetly ${data.version} is available`, {
      body: data.test === true ? 'Notifications are reaching this device.' : 'Open Budgetly to load the latest version.', icon: '/flowbudget-logo.png',
      tag: data.test === true ? 'budgetly-test' : 'budgetly-update', data: { version: data.version }
    })
  })())
})
self.addEventListener('notificationclick', event => {
  event.notification.close()
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin)
    if (existing) { await existing.navigate('/#/settings'); await existing.focus() }
    else await self.clients.openWindow('/#/settings')
  })())
})
