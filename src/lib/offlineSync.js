import { deleteOffline, listOffline, readOffline, writeOffline, updateOffline } from './offlineStore'

let activeUserId = null
let currentSync = null
const queuePath = path => path.split('?')[0] === '/api/transactions' || path.split('?')[0] === '/api/shared/transactions'
const cachedPath = path => /^\/api\/(wallets(?:\?|$)|categories(?:\?|$)|transactions(?:\?|$)|shared\/(?:wallets(?:\/\d+\/categories)?|transactions)(?:\?|$)|dashboard(?:\?|$)|attention(?:\?|$)|budgets(?:\?|$)|goals(?:\?|$)|debts(?:\?|$)|planned-transactions(?:\?|$))/.test(path)
const notify = () => window.dispatchEvent(new Event('budgetly:offline-queue-changed'))
const onlineCandidates = new WeakSet()
export const discardUncertainMessage = 'This entry may already have reached your wallet. Retry sync to confirm its result before removing it. Removing a local entry cannot undo a server save.'
export const canDiscardOffline = row => row?.attempted === false

export function setOfflineUser(userId) { activeUserId = userId == null ? null : String(userId); notify() }
export function offlineUser() { return activeUserId }
export function canQueueOffline(path, options) {
  const eligible = Boolean(activeUserId && options.method === 'POST' && queuePath(path) && typeof options.body === 'string')
  // api checks eligibility before sending and again on failure. Remember the
  // preflight even if the browser goes offline while awaiting the response.
  if (eligible && navigator.onLine !== false) onlineCandidates.add(options)
  return eligible
}
export function canCacheOffline(path) { return Boolean(activeUserId && (path === '/api/spaces' || cachedPath(path))) }

export async function cacheOfflineResponse(path, data) {
  if (!canCacheOffline(path)) return
  try { await writeOffline(`cache:${activeUserId}:${path}`, { data, savedAt: Date.now() }) }
  catch { /* Online reads remain usable without persistent storage. */ }
}

export async function readOfflineResponse(path) {
  if (!canCacheOffline(path)) return undefined
  const record = await readOffline(`cache:${activeUserId}:${path}`)
  if (record) window.dispatchEvent(new Event('budgetly:offline-data'))
  return record?.data
}

async function tokenFingerprint(token) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function rememberOfflineSession(user, settings, token) {
  if (!user?.id || !token) return
  try {
    await writeOffline(`session:${user.id}`, { user, settings, fingerprint: await tokenFingerprint(token) })
    localStorage.setItem('budgetly_offline_user', String(user.id))
  } catch { /* Offline reopening is optional when device storage is disabled. */ }
}

export async function restoreOfflineSession(token) {
  if (!token) return null
  try {
    const userId = localStorage.getItem('budgetly_offline_user')
    if (!userId) return null
    const saved = await readOffline(`session:${userId}`)
    return saved?.fingerprint === await tokenFingerprint(token) ? saved : null
  } catch { return null }
}

export async function queueOfflineTransaction(path, options) {
  if (!canQueueOffline(path, options)) throw new Error('Sign in online before saving transactions on this device.')
  const userId = activeUserId
  const rows = await listOffline(`queue:${userId}:`)
  if (rows.length >= 100) throw new Error('This device has 100 entries waiting to sync. Connect and sync them before adding more.')
  const id = crypto.randomUUID()
  const key = options.headers?.get?.('Idempotency-Key') || crypto.randomUUID()
  const payload = JSON.parse(options.body)
  const record = { id, userId, path, body: options.body, key, description: payload.description,
    amount: payload.amount, type: payload.type, wallet_id: payload.wallet_id,
    createdAt: Date.now(), status: 'pending', error: '', attempted: onlineCandidates.has(options) || navigator.onLine !== false }
  try { await writeOffline(`queue:${userId}:${id}`, record) }
  catch { throw new Error('Could not save this entry on the device. Keep the form open and try again online.') }
  window.dispatchEvent(new Event('budgetly:offline-data'))
  notify()
  return { queued: true, offline_id: id }
}

export async function listOfflineQueue(userId = activeUserId) {
  if (!userId) return []
  const rows = await listOffline(`queue:${userId}:`)
  return rows.map(row => row.value).sort((a, b) => a.createdAt - b.createdAt)
}

export async function discardOfflineTransaction(id, userId = activeUserId) {
  if (!userId) return
  await updateOffline(`queue:${userId}:${id}`, record => {
    if (record && !canDiscardOffline(record)) throw new Error(discardUncertainMessage)
    return undefined
  })
  notify()
}

export async function retryOfflineTransaction(id, userId = activeUserId) {
  if (!userId) return
  await updateOffline(`queue:${userId}:${id}`, record => record ? { ...record, status: 'pending', error: '' } : undefined)
  notify()
}

export function syncOfflineQueue(send, token, userId = activeUserId) {
  if (!userId || !token || navigator.onLine === false) return Promise.resolve()
  if (currentSync) return currentSync
  window.dispatchEvent(new CustomEvent('budgetly:sync-state', { detail: { userId: String(userId), syncing: true } }))
  currentSync = (async () => {
    const rows = await listOfflineQueue(userId)
    for (const candidate of rows) {
      if (activeUserId !== String(userId) || navigator.onLine === false) break
      const storageKey = `queue:${userId}:${candidate.id}`
      const row = await updateOffline(storageKey, record => {
        if (!record || record.status === 'failed') return record
        return { ...record, attempted: true }
      })
      if (!row || row.status === 'failed') continue
      notify()
      // Storage may have yielded across an account switch. Never send as it.
      if (activeUserId !== String(userId) || navigator.onLine === false) break
      try {
        const headers = new Headers({ 'Idempotency-Key': row.key })
        await send(row.path, { method: 'POST', body: row.body, headers })
        await deleteOffline(`queue:${userId}:${row.id}`)
        if (activeUserId === String(userId)) {
          notify()
          window.dispatchEvent(new Event('budgetly:offline-synced'))
        }
      } catch (error) {
        if (error.staleAuth || error.network || error.status === 401 || error.status >= 500) break
        await updateOffline(storageKey, record => record ? { ...record, status: 'failed', error: error.message } : undefined)
        notify()
      }
    }
  })().finally(() => { currentSync = null; window.dispatchEvent(new CustomEvent('budgetly:sync-state', { detail: { userId: String(userId), syncing: false } })) })
  return currentSync
}
