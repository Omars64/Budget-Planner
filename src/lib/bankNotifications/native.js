import { Capacitor, registerPlugin } from '@capacitor/core'
import { api, auth, jsonBody } from '../api'
import { notificationHash, parseBankNotification } from './parser'

export const BankNotifications = registerPlugin('BankNotifications')
export const bankNotificationsAvailable = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
export const bankInboxChanged = 'budgetly:bank-inbox-changed'
let syncing = false

export async function syncBankNotifications(owner) {
  if (!bankNotificationsAvailable() || syncing || !navigator.onLine) return
  const token = auth.token
  if (!token) return
  syncing = true
  try {
    const { notifications } = await BankNotifications.getPendingNotifications({ owner: String(owner) })
    for (const raw of notifications) {
      if (auth.token !== token) return
      const parsed = parseBankNotification(raw)
      if (parsed.recognized) {
        const { recognized: _recognized, ...candidate } = parsed
        await api('/api/bank-inbox/ingest', { method: 'POST', ...jsonBody({ ...candidate, content_hash: await notificationHash(raw), source_package: raw.packageName, source_app: raw.appLabel || raw.packageName }) })
      }
      // Rejected security/non-transaction alerts never leave this device.
      await BankNotifications.removeNotifications({ owner: String(owner), ids: [raw.id] })
    }
    window.dispatchEvent(new Event(bankInboxChanged))
  } finally { syncing = false }
}

export async function suspendBankCapture() {
  if (bankNotificationsAvailable()) await BankNotifications.suspend()
}
