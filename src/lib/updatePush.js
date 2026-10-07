import { PushNotifications } from '@capacitor/push-notifications'
import { version } from '../../package.json'
import { api, auth, jsonBody, publicApiUrl } from './api'
import { androidUpdatesAvailable, AppUpdater } from './appUpdates'
import { updateNotificationsEnabled, scheduledNotificationsEnabled } from './notificationSettings'

const idsKey = 'budgetly-update-push-device-v1'
let queue = Promise.resolve()
async function deviceId() {
  const me = await api('/api/auth/me')
  const ids = JSON.parse(localStorage.getItem(idsKey) || '{}')
  if (!ids[me.id]) { ids[me.id] = crypto.randomUUID(); localStorage.setItem(idsKey, JSON.stringify(ids)) }
  return ids[me.id]
}
export async function pushConfiguration() {
  const response = await fetch(publicApiUrl('/api/app-updates/push-config'), { cache: 'no-store', credentials: 'omit' })
  if (!response.ok) throw new Error('Could not check closed-app update delivery.')
  return response.json()
}
function applicationKey(value) {
  const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4))
  return Uint8Array.from(raw, char => char.charCodeAt(0))
}
async function workerPreference(registration, enabled, scheduled = false) {
  if (!registration?.active) return
  await new Promise(resolve => {
    const channel = new window.MessageChannel()
    const finish = () => { clearTimeout(timer); channel.port1.close(); resolve() }
    const timer = setTimeout(finish, 2000)
    channel.port1.onmessage = finish
    registration.active.postMessage({ type: 'budgetly-update-preference', enabled, scheduled }, [channel.port2])
  })
}
async function androidToken() {
  const handles = []
  try {
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Android push registration timed out. Check Firebase setup.')), 15000)
      const done = fn => value => { clearTimeout(timeout); fn(value) }
      void (async () => {
        handles.push(await PushNotifications.addListener('registration', done(value => resolve(value.value))))
        handles.push(await PushNotifications.addListener('registrationError', done(value => reject(new Error(value.error || 'Android push registration failed.')))))
        await PushNotifications.register()
      })().catch(done(reject))
    })
  } finally { await Promise.all(handles.map(handle => handle.remove())) }
}
async function sync(enabled) {
  const scheduled = Boolean(auth.token && scheduledNotificationsEnabled())
  if (androidUpdatesAvailable()) await AppUpdater.setPushAlerts(scheduled ? { enabled, scheduled } : { enabled })
  if (!enabled && !scheduled) {
    if (androidUpdatesAvailable()) { try { await PushNotifications.unregister() } catch { /* Firebase may be unconfigured. */ } }
    else if ('serviceWorker' in navigator) { const registration = await navigator.serviceWorker.getRegistration('/'); await workerPreference(registration,false); await (await registration?.pushManager.getSubscription())?.unsubscribe() }
    if (!auth.token) return { enabled: false }
    const id = await deviceId()
    await api(`/api/app-updates/push-device/${id}`, { method: 'DELETE' })
    return { enabled: false }
  }
  if (!auth.token || (!updateNotificationsEnabled() && !scheduled)) return { enabled: false }
  const config = await pushConfiguration(), native = androidUpdatesAvailable()
  if (!config[native ? 'android' : 'browser']) return { configured: false }
  const id = await deviceId()
  let token, subscription
  if (native) {
    if (!(await AppUpdater.info()).pushConfigured) return { configured: false }
    if ((await PushNotifications.checkPermissions()).receive !== 'granted') return { enabled: false }
    await PushNotifications.createChannel({ id: 'budgetly-updates', name: 'App updates', importance: 3 })
    token = await androidToken()
  } else {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || window.Notification?.permission !== 'granted') return { enabled: false }
    await navigator.serviceWorker.register('/budgetly-push-sw.js', { scope: '/' })
    const registration = await navigator.serviceWorker.ready
    await workerPreference(registration,enabled,scheduled)
    subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationKey(config.public_key) })
    subscription = subscription.toJSON()
  }
  if (!updateNotificationsEnabled() && !scheduledNotificationsEnabled()) return sync(false)
  await api('/api/app-updates/push-device', { method: 'PUT', ...jsonBody({ id, platform: native ? 'android' : 'browser', version, token, subscription, updates: enabled, scheduled }) })
  return { enabled: true, configured: true }
}
export function syncUpdatePush(enabled) {
  queue = queue.catch(() => {}).then(() => sync(enabled))
  return queue
}
