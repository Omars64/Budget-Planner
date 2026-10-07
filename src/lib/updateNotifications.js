import { LocalNotifications } from '@capacitor/local-notifications'
import { androidUpdatesAvailable } from './appUpdates'
import { updateNotificationsEnabled } from './notificationSettings'

export const UPDATE_NOTIFICATION_ID = 1500
const key = () => `budgetly-update-notified-${androidUpdatesAvailable() ? 'android' : 'browser'}`
let pending = Promise.resolve()
let browserNotice
export async function cancelUpdateNotification() {
  browserNotice?.close(); browserNotice = null
  if (androidUpdatesAvailable()) await LocalNotifications.cancel({ notifications: [{ id: UPDATE_NOTIFICATION_ID }] })
}
export function notifyAppUpdate(release, onClick) {
  const send = async () => {
    if (!updateNotificationsEnabled()) return false
    try { if (localStorage.getItem(key()) === release.version) return false } catch { /* Optional deduplication storage. */ }
    const title = `Budgetly ${release.version} is available`
    const body = androidUpdatesAvailable() ? 'Open Budgetly to review and install the update.' : 'Open Budgetly to load the latest version.'
    if (androidUpdatesAvailable()) {
      if ((await LocalNotifications.checkPermissions()).display !== 'granted' || !updateNotificationsEnabled()) return false
      await LocalNotifications.createChannel({ id: 'budgetly-updates', name: 'App updates', importance: 3, visibility: 0 })
      await LocalNotifications.schedule({ notifications: [{ id: UPDATE_NOTIFICATION_ID, title, body,
        channelId: 'budgetly-updates', smallIcon: 'flowbudget_notification', iconColor: '#0a4173',
        extra: { budgetlyUpdate: true, version: release.version } }] })
    } else {
      if (!('Notification' in window) || window.Notification.permission !== 'granted') return false
      browserNotice?.close()
      try { browserNotice = new window.Notification(title, { body, icon: '/notification-wallet.svg', tag: 'budgetly-update' }) }
      catch { return false }
      browserNotice.onclick = () => { window.focus(); onClick(); browserNotice?.close() }
    }
    if (!updateNotificationsEnabled()) { await cancelUpdateNotification(); return false }
    try { localStorage.setItem(key(), release.version) } catch { /* A blocked store must not break updates. */ }
    return true
  }
  pending = pending.catch(() => {}).then(send)
  return pending
}
