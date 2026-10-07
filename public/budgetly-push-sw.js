/* Update delivery only: no page caching or financial records. */
const preferenceStore = 'budgetly-push-preference-v1'
self.addEventListener('message', event => {
  if (event.data?.type !== 'budgetly-update-preference') return
  event.waitUntil((async () => {
    const store = await self.caches.open(preferenceStore)
    await store.put('/budgetly-push-enabled', new Response(String(Boolean(event.data.enabled))))
    await store.put('/budgetly-scheduled-enabled', new Response(String(Boolean(event.data.scheduled))))
    event.ports[0]?.postMessage({saved:true})
    if (!event.data.enabled) {
      for (const tag of ['budgetly-update', 'budgetly-test']) {
        for (const notice of await self.registration.getNotifications({tag})) notice.close()
      }
    }
    if (!event.data.scheduled) {
      for (const notice of await self.registration.getNotifications()) {
        if (notice.tag.startsWith('budgetly-scheduled-')) notice.close()
      }
    }
  })())
})
self.addEventListener('push', event => {
  event.waitUntil((async () => {
    const store = await self.caches.open(preferenceStore)
    let data
    try { data = event.data.json() } catch { return }
    const scheduled = data.kind === 'scheduled'
    const enabled = await store.match(scheduled ? '/budgetly-scheduled-enabled' : '/budgetly-push-enabled')
    if (scheduled ? !enabled || await enabled.text() !== 'true' : enabled && await enabled.text() === 'false') return
    if (!/^\d+\.\d+\.\d+$/.test(data.version)) return
    if (scheduled) {
      if (!/^\d{1,12}$/.test(data.event)) return
      await self.registration.showNotification('Scheduled entry recorded', {
        body: data.body, icon: '/notification-wallet.svg', tag: `budgetly-scheduled-${data.event}`, data: {scheduled:true}
      })
      return
    }
    await self.registration.showNotification(data.test === true ? 'Budgetly test notification' : `Budgetly ${data.version} is available`, {
      body: data.test === true ? 'Notifications are reaching this device.' : 'Open Budgetly to load the latest version.', icon: '/notification-wallet.svg',
      tag: data.test === true ? 'budgetly-test' : 'budgetly-update', data: { version: data.version }
    })
  })())
})
self.addEventListener('notificationclick', event => {
  event.notification.close()
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin)
    const path = event.notification.data?.scheduled ? '/#/upcoming' : '/#/settings'
    if (existing) { await existing.navigate(path); await existing.focus() }
    else await self.clients.openWindow(path)
  })())
})
