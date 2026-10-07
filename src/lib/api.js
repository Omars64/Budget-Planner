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
const responseCache = new Map()
export const readCached = path => {
  path = scopedPath(path)
  const value = responseCache.get(path)
  return value?.token === auth.token && Date.now() - value.time < 60000 ? value.data : undefined
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
    setApiSpace(null)
    responseCache.clear()
    const userId = offlineUser()
    setOfflineUser(null)
    if (userId) void clearOfflineCache(userId).catch(() => {})
    try { localStorage.removeItem('budgetly_offline_user') } catch { /* Optional offline session. */ }
    sessionStorage.removeItem(tokenKey)
    localStorage.removeItem(tokenKey)
    Object.keys(sessionStorage).filter(key => key.startsWith('flowbudget_note_draft_')).forEach(key => sessionStorage.removeItem(key))
    for (const storage of [sessionStorage, localStorage]) {
      Object.keys(storage).filter(key => key !== 'flowbudget_tx_draft_guest' && /^flowbudget_(shared_)?tx_draft_/.test(key)).forEach(key => storage.removeItem(key))
    }
  },
}

const pending = new Map()
const transactionKeys = new Map()
let writes = 0
export const hasPendingWrites = () => writes > 0
export function api(path, options = {}) {
  if (guestActive() && !auth.token && !path.startsWith('/api/auth/') && !path.startsWith('/api/passkeys/login/')) return guestApi(path, options)
  path = scopedPath(path)
  if (options.method === 'PUT' && options.body) {
    try { const data = JSON.parse(options.body); if (data.revision) { const headers = new Headers(options.headers); headers.set('If-Match', data.revision); options = {...options, headers} } } catch { /* Non-JSON requests do not carry revisions. */ }
  }
  const key = JSON.stringify([auth.token, path, options.method || 'GET', options.body || ''])
  if (!options.signal && pending.has(key)) return pending.get(key)
  const transaction = options.method === 'POST' && !path.startsWith('/api/auth/') && !path.startsWith('/api/passkeys/') && path !== '/api/account/confirm'
  if (transaction) {
    if (!transactionKeys.has(key)) transactionKeys.set(key, crypto.randomUUID())
    const headers = new Headers(options.headers)
    headers.set('Idempotency-Key', transactionKeys.get(key))
    options = { ...options, headers }
  }
  const mutation = options.method && options.method !== 'GET'
  if (mutation) window.dispatchEvent(new CustomEvent('flowbudget:pending', { detail: ++writes }))
  const request = (canQueueOffline(path, options) && navigator.onLine === false
    ? queueOfflineTransaction(path, options)
    : send(path, options).catch(error => {
      if ((error.network || [502, 503, 504].includes(error.status)) && canQueueOffline(path, options)) return queueOfflineTransaction(path, options)
      throw error
    })).catch(async error => {
    if (error.status !== 428) throw error
    await new Promise((resolve,reject)=>window.dispatchEvent(new CustomEvent('flowbudget:confirm-password',{detail:{resolve,reject}})))
    return send(path,options)
  }).then(data => {
    if (transaction) transactionKeys.delete(key)
    return data
  }).catch(error => {
    if (transaction && error.status >= 400 && error.status < 500) transactionKeys.delete(key)
    if (mutation && !path.endsWith('/poll')) window.dispatchEvent(new CustomEvent('flowbudget:error', { detail:error.message || 'The request could not be saved. Please try again.' }))
    throw error
  }).finally(() => {
    if (pending.get(key) === request) pending.delete(key)
    if (mutation) window.dispatchEvent(new CustomEvent('flowbudget:pending', { detail: --writes }))
  })
  if (!options.signal) pending.set(key, request)
  return request
}

async function send(path, options = {}) {
  if ((!options.method || options.method === 'GET') && navigator.onLine === false) {
    try {
      const cached = await readOfflineResponse(path)
      if (cached !== undefined) return cached
    } catch { /* Continue with the normal request error. */ }
  }
  const headers = new Headers(options.headers || {})
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  if (auth.token) headers.set('Authorization', `Bearer ${auth.token}`)
  let response
  try { response = await fetch(`${apiBase}${path}`, { ...options, headers }) }
  catch (cause) {
    if (cause?.name === 'AbortError') throw cause
    if (!options.method || options.method === 'GET') {
      try {
        const cached = await readOfflineResponse(path)
        if (cached !== undefined) return cached
      } catch { /* Report the network error below. */ }
    }
    const error = new Error(path.startsWith('/api/auth/')
      ? 'Could not connect to Budgetly for sign-in. Check your connection and try again.'
      : 'Could not reach Budgetly. Check your connection and retry; transaction retries are protected against duplicates.')
    error.network = true
    throw error
  }
  if (response.status === 204) { responseCache.clear(); return null }
  let data = null
  try { data = await response.json() } catch { data = null }
  if (!response.ok) {
    if ([502, 503, 504].includes(response.status) && (!options.method || options.method === 'GET')) {
      try {
        const cached = await readOfflineResponse(path)
        if (cached !== undefined) return cached
      } catch { /* Report the service error below. */ }
    }
    const message = data?.detail || (response.status >= 500
      ? 'The service is temporarily unavailable. Please try again shortly.'
      : `Request failed (${response.status})`)
    const error = new Error(Array.isArray(message) ? message.map(x => `${x.loc?.slice(1).join(' ') || 'Field'}: ${x.msg}`).join(', ') : message)
    error.status = response.status
    throw error
  }
  if (!options.method || options.method === 'GET') {
    if (path.startsWith('/api/shared/') || path.split('?')[0] === '/api/wallets') responseCache.set(path, { token: auth.token, time: Date.now(), data })
    await cacheOfflineResponse(path, data)
  } else responseCache.clear()
  window.dispatchEvent(new Event('budgetly:service-available'))
  return data
}

export const flushOfflineTransactions = () => syncOfflineQueue(send, auth.token)

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
  const headers = new Headers()
  if (auth.token) headers.set('Authorization', `Bearer ${auth.token}`)
  let response
  try { response = await fetch(`${apiBase}${path}`, { headers }) }
  catch { throw new Error('Could not reach Budgetly. Check your connection and try again.') }
  if (!response.ok) {
    let detail
    try { detail = (await response.json()).detail } catch { /* Use the status below. */ }
    throw new Error(typeof detail === 'string' ? detail : `Download failed (${response.status})`)
  }
  return response.blob()
}
