import { Capacitor, registerPlugin } from '@capacitor/core'
import { api, auth, jsonBody } from '../api'
import { notificationHash, parseBankNotification } from './parser'

export const BankNotifications = registerPlugin('BankNotifications')
export const bankNotificationsAvailable = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
export const bankInboxChanged = 'budgetly:bank-inbox-changed'
let activeSync

export function watchBankNotifications(owner) {
  const token = auth.token
  let active = true
  let listener
  let retryTimer
  const sync = async () => {
    window.clearTimeout(retryTimer)
    if (!active || !token || auth.token !== token || !navigator.onLine || document.visibilityState === 'hidden') return
    try {
      await BankNotifications.bindSession({ owner: String(owner) })
      if (active && auth.token === token) await syncBankNotifications(owner)
    } catch (error) {
      // Queued alerts remain on the device when the ingest request fails.
      if (active && auth.token === token && (error.network || !error.status || error.status >= 500 || error.status === 429)) {
        window.clearTimeout(retryTimer)
        retryTimer = window.setTimeout(sync, 15_000)
      }
    }
  }
  void BankNotifications.addListener('notificationQueued', sync).then(handle => {
    if (active) listener = handle
    else return handle.remove()
  }).catch(() => {}).finally(sync)
  window.addEventListener('online', sync)
  window.addEventListener('focus', sync)
  document.addEventListener('visibilitychange', sync)
  return () => {
    active = false
    window.clearTimeout(retryTimer)
    void listener?.remove().catch(() => {})
    window.removeEventListener('online', sync)
    window.removeEventListener('focus', sync)
    document.removeEventListener('visibilitychange', sync)
  }
}

export function syncBankNotifications(owner) {
  if (!bankNotificationsAvailable() || !navigator.onLine) return Promise.resolve()
  const token = auth.token
  if (!token) return Promise.resolve()
  owner = String(owner)
  if (activeSync?.token === token && activeSync.owner === owner) {
    activeSync.repeat = true
    return activeSync.promise
  }
  const sync = { token, owner, repeat: false }
  activeSync = sync
  sync.promise = drain(sync).finally(() => { if (activeSync === sync) activeSync = null })
  return sync.promise
}

async function drain(sync) {
  const { token, owner } = sync
  let changed = false
  try {
    do {
      sync.repeat = false
      const { notifications } = await BankNotifications.getPendingNotifications({ owner })
      for (const raw of notifications) {
        if (auth.token !== token || !navigator.onLine) return
        const parsed = parseBankNotification(raw)
        if (parsed.recognized) {
          const { recognized: _recognized, ...candidate } = parsed
          const content_hash = await notificationHash(raw)
          if (auth.token !== token || !navigator.onLine) return
          await api('/api/bank-inbox/ingest', { method: 'POST', ...jsonBody({ ...candidate, content_hash, source_package: raw.packageName, source_app: raw.appLabel || raw.packageName }) })
          changed = true
        }
        if (auth.token !== token) return
        // Acknowledge only after capture is accepted or rejected locally.
        await BankNotifications.removeNotifications({ owner, ids: [raw.id] })
      }
      sync.repeat ||= notifications.length >= 100
    } while (sync.repeat && auth.token === token && navigator.onLine)
  } finally {
    if (changed && auth.token === token) window.dispatchEvent(new Event(bankInboxChanged))
  }
}

export async function suspendBankCapture() {
  if (bankNotificationsAvailable()) await BankNotifications.suspend()
}
