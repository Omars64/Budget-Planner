import { Capacitor } from '@capacitor/core'
import {currencyDigits} from './currency'
import { scopedPath, setApiSpace } from './spaces'
import { guestActive, guestApi, requestGuestSignIn } from './guest'
import { clearOfflineCache } from './offlineStore'
import { cacheOfflineResponse, canQueueOffline, offlineUser, queueOfflineTransaction, readOfflineResponse, setOfflineUser, syncOfflineQueue } from './offlineSync'

const tokenKey = 'flowbudget_token'
const rememberKey = 'flowbudget_remember_session'
const nativeApiBase = 'https://budget-planner-ecru-seven.vercel.app'
const apiBase = import.meta.env.VITE_API_BASE_URL || (Capacitor.isNativePlatform() ? nativeApiBase : '')
export const publicApiUrl = path => apiBase + path
export const sessionExpiredEvent = 'budgetly:session-expired'
const legacySessionErrors = new Set(['Session expired', 'Account is inactive', 'Please sign in again', 'Please sign in again. This session has ended.'])
let expiredToken
const responseCache = new Map()
let cacheRevision = 0
const pathName = path => path.split('?')[0]
const isEntryWrite = path => /^\/api\/(?:shared\/)?transactions(?:\/\d+)?$/.test(pathName(path))
const memoryRead = path => path.startsWith('/api/shared/') || ['/api/wallets','/api/categories','/api/transactions','/api/dashboard'].includes(pathName(path))

function invalidateReads(path = '') {
  cacheRevision += 1
  if (!isEntryWrite(path)) responseCache.clear()
  else for (const key of responseCache.keys()) {
    // Recording an entry changes balances and ledger rows, but not categories.
    if (pathName(key) !== '/api/categories' && !/^\/api\/shared\/wallets\/\d+\/categories$/.test(pathName(key))) responseCache.delete(key)
  }
}
export const readCached = path => {
  path = scopedPath(path)
  const value = responseCache.get(path)
  return value?.token === auth.token && value.userId === offlineUser() && Date.now() - value.time < 60000 ? value.data : undefined
}

export const auth = {
  get remembered() {
    try { return localStorage.getItem(rememberKey) === 'true' } catch { return false }
  },
  setRemembered(value) {
    try {
      localStorage.setItem(rememberKey, String(Boolean(value)))
      if (!value) localStorage.removeItem(tokenKey)
    } catch { if (value) throw new Error('Allow site storage to keep you signed in on this device.') }
  },
  get token() {
    try { return sessionStorage.getItem(tokenKey) || (auth.remembered ? localStorage.getItem(tokenKey) || '' : '') } catch { return '' }
  },
  get expired() {
    return Boolean(expiredToken && auth.token === expiredToken)
  },
  set token(value) {
    try {
      if (value) {
        sessionStorage.setItem(tokenKey, value)
        if (auth.remembered) localStorage.setItem(tokenKey, value)
        else localStorage.removeItem(tokenKey)
      } else {
        sessionStorage.removeItem(tokenKey)
        localStorage.removeItem(tokenKey)
      }
    } catch { throw new Error('Allow site storage to complete sign-in.') }
  },
  clear() {
    const rejectedToken = auth.expired ? expiredToken : null
    window.dispatchEvent(new Event('budgetly:auth-cleared'))
    setApiSpace(null)
    invalidateReads()
    const userId = offlineUser()
    setOfflineUser(null)
    if (userId) void clearOfflineCache(userId).catch(() => {})
    try { localStorage.removeItem('budgetly_offline_user') } catch { /* Optional offline session. */ }
    sessionStorage.removeItem(tokenKey)
    if (!rejectedToken || localStorage.getItem(tokenKey) === rejectedToken) localStorage.removeItem(tokenKey)
    expiredToken = undefined
    Object.keys(sessionStorage).filter(key => key.startsWith('flowbudget_note_draft_')).forEach(key => sessionStorage.removeItem(key))
    for (const storage of [sessionStorage, localStorage]) {
      Object.keys(storage).filter(key => key !== 'flowbudget_tx_draft_guest' && /^flowbudget_(shared_)?tx_draft_/.test(key)).forEach(key => storage.removeItem(key))
    }
  },
}

function sessionExpiredError() {
  return Object.assign(new Error('Session expired. Logging out now…'), { status: 401, sessionExpired: true })
}

function detectExpiredSession(response, detail, token) {
  if (!token || token !== auth.token || response.status !== 401) return
  // Older hosted APIs still return the original messages during rollout.
  if (response.headers?.get('WWW-Authenticate') !== 'Bearer error="invalid_token"' && !legacySessionErrors.has(detail)) return
  if (!auth.expired) {
    expiredToken = token
    invalidateReads()
    window.dispatchEvent(new Event(sessionExpiredEvent))
  }
  throw sessionExpiredError()
}

const pending = new Map()
const transactionKeys = new Map()
let writes = 0
export const hasPendingWrites = () => writes > 0
function assertRequestIdentity(token, userId) {
  if (auth.token !== token || offlineUser() !== userId) {
    throw Object.assign(new Error('Your account changed while this request was in progress. Reopen this screen before trying again.'), { staleAuth: true })
  }
  if (auth.expired) throw sessionExpiredError()
}
export function api(path, options = {}) {
  if (auth.expired) return Promise.reject(sessionExpiredError())
  if (guestActive() && !auth.token && !path.startsWith('/api/auth/') && !path.startsWith('/api/passkeys/login/')) return guestApi(path, options)
  path = scopedPath(path)
  if (options.method === 'PUT' && options.body) {
    try { const data = JSON.parse(options.body); if (data.revision) { const headers = new Headers(options.headers); headers.set('If-Match', data.revision); options = {...options, headers} } } catch { /* Non-JSON requests do not carry revisions. */ }
  }
  const suppliedKey = new Headers(options.headers).get('Idempotency-Key')
  const mutation = options.method && options.method !== 'GET'
  const key = JSON.stringify([auth.token, offlineUser(), path, options.method || 'GET', options.body || '', suppliedKey, mutation ? null : cacheRevision])
  if (!options.signal && pending.has(key)) return pending.get(key)
  const transaction = options.method === 'POST' && !path.startsWith('/api/auth/') && !path.startsWith('/api/passkeys/') && path !== '/api/account/confirm'
  if (transaction) {
    if (!transactionKeys.has(key)) transactionKeys.set(key, crypto.randomUUID())
    const headers = new Headers(options.headers)
    headers.set('Idempotency-Key', suppliedKey || transactionKeys.get(key))
    options = { ...options, headers }
  }
  const requestUser = offlineUser()
  const requestToken = auth.token
  if (mutation) window.dispatchEvent(new CustomEvent('flowbudget:pending', { detail: ++writes }))
  const request = (canQueueOffline(path, options) && navigator.onLine === false
    ? queueOfflineTransaction(path, options)
    : send(path, options).catch(error => {
      if ((error.network || [502, 503, 504].includes(error.status)) && requestUser === offlineUser() && requestToken === auth.token && canQueueOffline(path, options)) return queueOfflineTransaction(path, options)
      throw error
    })).catch(async error => {
    if (error.status !== 428) throw error
    assertRequestIdentity(requestToken, requestUser)
    await new Promise((resolve,reject)=>window.dispatchEvent(new CustomEvent('flowbudget:confirm-password',{detail:{resolve,reject}})))
    assertRequestIdentity(requestToken, requestUser)
    return send(path,options)
  }).then(data => {
    assertRequestIdentity(requestToken, requestUser)
    if (transaction) transactionKeys.delete(key)
    return data
  }).catch(error => {
    if (transaction && error.status >= 400 && error.status < 500) transactionKeys.delete(key)
    if (mutation && !error.sessionExpired && !path.endsWith('/poll')) window.dispatchEvent(new CustomEvent('flowbudget:error', { detail:error.message || 'The request could not be saved. Please try again.' }))
    throw error
  }).finally(() => {
    if (pending.get(key) === request) pending.delete(key)
    if (mutation) window.dispatchEvent(new CustomEvent('flowbudget:pending', { detail: --writes }))
  })
  if (!options.signal) pending.set(key, request)
  return request
}

async function send(path, options = {}) {
  const requestToken = auth.token
  const requestUser = offlineUser()
  const startedAtRevision = cacheRevision
  const checkIdentity = () => assertRequestIdentity(requestToken, requestUser)
  const readFallback = async () => {
    checkIdentity()
    let cached
    try { cached = await readOfflineResponse(path) } catch { /* Report the normal request error. */ }
    checkIdentity()
    return cached
  }
  if ((!options.method || options.method === 'GET') && navigator.onLine === false) {
    const cached = await readFallback()
    if (cached !== undefined) return cached
    throw Object.assign(new Error('No saved data is available for this view. Reconnect to load it.'), { network: true })
  }
  const headers = new Headers(options.headers || {})
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  if (requestToken) headers.set('Authorization', `Bearer ${requestToken}`)
  let response
  const timeout = new AbortController()
  const limit = window.setTimeout(() => timeout.abort(), options.method && options.method !== 'GET' ? 20000 : 8000)
  const signal = options.signal ? AbortSignal.any([options.signal, timeout.signal]) : timeout.signal
  try { response = await fetch(`${apiBase}${path}`, { ...options, headers, signal }) }
  catch (cause) {
    checkIdentity()
    if (options.signal?.aborted) throw cause
    if (!options.method || options.method === 'GET') {
      const cached = await readFallback()
      if (cached !== undefined) return cached
    }
    const error = new Error(path.startsWith('/api/auth/')
      ? 'Could not connect to Budgetly for sign-in. Check your connection and try again.'
      : 'Could not reach Budgetly. Check your connection and retry; transaction retries are protected against duplicates.')
    error.network = true
    throw error
  } finally { window.clearTimeout(limit) }
  checkIdentity()
  if (response.status === 204) { invalidateReads(path); return null }
  let data = null
  try { data = await response.json() } catch {
    checkIdentity()
    if (response.ok) {
      const error = new Error('Could not confirm the server response. Retry to confirm this save safely.')
      error.network = true
      throw error
    }
  }
  checkIdentity()
  if (!response.ok) {
    if ([401, 403].includes(response.status)) responseCache.delete(path)
    detectExpiredSession(response, data?.detail, requestToken)
    if ([502, 503, 504].includes(response.status) && (!options.method || options.method === 'GET')) {
      const cached = await readFallback()
      if (cached !== undefined) return cached
    }
    const message = data?.detail || (response.status >= 500
      ? 'The service is temporarily unavailable. Please try again shortly.'
      : `Request failed (${response.status})`)
    const error = new Error(Array.isArray(message) ? message.map(x => `${x.loc?.slice(1).join(' ') || 'Field'}: ${x.msg}`).join(', ') : message)
    error.status = response.status
    throw error
  }
  if (!options.method || options.method === 'GET') {
    if (startedAtRevision === cacheRevision) {
      if (requestToken && memoryRead(path)) {
        responseCache.delete(path)
        if (responseCache.size >= 64) responseCache.delete(responseCache.keys().next().value)
        responseCache.set(path, { token: requestToken, userId: requestUser, time: Date.now(), data })
      }
      await cacheOfflineResponse(path, data)
    }
  } else if (!path.endsWith('/poll')) invalidateReads(path)
  checkIdentity()
  window.dispatchEvent(new Event('budgetly:service-available'))
  return data
}

export const flushOfflineTransactions = () => {
  const token = auth.token
  const userId = offlineUser()
  return syncOfflineQueue((path, options) => {
    assertRequestIdentity(token, userId)
    return send(path, options)
  }, token, userId)
}

export const money = (value, currency = 'KWD', compact = false) => {
  const n = Number(value || 0)
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency', currency,
      minimumFractionDigits: compact ? 0 : currencyDigits(currency),
      maximumFractionDigits: currencyDigits(currency),
      notation: compact ? 'compact' : 'standard',
    }).format(n)
  } catch {
    return `${n.toFixed(currencyDigits(currency))} ${currency}`
  }
}

export const jsonBody = value => ({ body: JSON.stringify(value) })

export async function apiFile(path) {
  path = scopedPath(path)
  if (guestActive() && !auth.token) {
    requestGuestSignIn('account exports')
    throw Object.assign(new Error('Sign in for account exports. Guest CSV and JSON exports are available in Settings.'), { status: 403 })
  }
  const token = auth.token
  const userId = offlineUser()
  assertRequestIdentity(token, userId)
  const headers = new Headers()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  let response
  try { response = await fetch(`${apiBase}${path}`, { headers }) }
  catch { throw new Error('Could not reach Budgetly. Check your connection and try again.') }
  assertRequestIdentity(token, userId)
  if (!response.ok) {
    let detail
    try { detail = (await response.json()).detail } catch { /* Use the status below. */ }
    assertRequestIdentity(token, userId)
    detectExpiredSession(response, detail, token)
    throw new Error(typeof detail === 'string' ? detail : `Download failed (${response.status})`)
  }
  const blob = await response.blob()
  assertRequestIdentity(token, userId)
  return blob
}
