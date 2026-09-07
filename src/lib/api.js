const tokenKey = 'flowbudget_token'
const responseCache = new Map()
export const readCached = path => {
  const value = responseCache.get(path)
  return value?.token === auth.token && Date.now() - value.time < 60000 ? value.data : undefined
}

export const auth = {
  get token() { return sessionStorage.getItem(tokenKey) || '' },
  set token(value) { value ? sessionStorage.setItem(tokenKey, value) : sessionStorage.removeItem(tokenKey) },
  clear() {
    responseCache.clear()
    sessionStorage.removeItem(tokenKey)
    Object.keys(sessionStorage).filter(key => key.startsWith('flowbudget_note_draft_')).forEach(key => sessionStorage.removeItem(key))
  },
}

const pending = new Map()
const transactionKeys = new Map()
let writes = 0
export function api(path, options = {}) {
  const key = JSON.stringify([auth.token, path, options.method || 'GET', options.body || ''])
  if (!options.signal && pending.has(key)) return pending.get(key)
  const transaction = options.method === 'POST' && ['/api/transactions', '/api/shared/transactions'].includes(path)
  if (transaction) {
    if (!transactionKeys.has(key)) transactionKeys.set(key, crypto.randomUUID())
    const headers = new Headers(options.headers)
    headers.set('Idempotency-Key', transactionKeys.get(key))
    options = { ...options, headers }
  }
  const mutation = options.method && options.method !== 'GET'
  if (mutation) window.dispatchEvent(new CustomEvent('flowbudget:pending', { detail: ++writes }))
  const request = send(path, options).then(data => {
    if (transaction) transactionKeys.delete(key)
    return data
  }).catch(error => {
    if (mutation) window.dispatchEvent(new CustomEvent('flowbudget:error', { detail:error.message || 'The request could not be saved. Please try again.' }))
    throw error
  }).finally(() => {
    if (pending.get(key) === request) pending.delete(key)
    if (mutation) window.dispatchEvent(new CustomEvent('flowbudget:pending', { detail: --writes }))
  })
  if (!options.signal) pending.set(key, request)
  return request
}

async function send(path, options = {}) {
  const headers = new Headers(options.headers || {})
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  if (auth.token) headers.set('Authorization', `Bearer ${auth.token}`)
  let response
  try { response = await fetch(path, { ...options, headers }) }
  catch { throw new Error('Could not reach FlowBudget. Check your connection and retry; transaction retries are protected against duplicates.') }
  if (response.status === 204) { responseCache.clear(); return null }
  let data = null
  try { data = await response.json() } catch { data = null }
  if (!response.ok) {
    const message = data?.detail || (response.status >= 500
      ? 'The service is temporarily unavailable. Please try again shortly.'
      : `Request failed (${response.status})`)
    const error = new Error(Array.isArray(message) ? message.map(x => `${x.loc?.slice(1).join(' ') || 'Field'}: ${x.msg}`).join(', ') : message)
    error.status = response.status
    throw error
  }
  if (!options.method || options.method === 'GET') {
    if (path.startsWith('/api/shared/') || path === '/api/wallets') responseCache.set(path, { token: auth.token, time: Date.now(), data })
  } else responseCache.clear()
  return data
}

export const money = (value, currency = 'KWD', compact = false) => {
  const n = Number(value || 0)
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency', currency,
      maximumFractionDigits: currency === 'KWD' ? 3 : 2,
      notation: compact ? 'compact' : 'standard',
    }).format(n)
  } catch {
    return `${n.toFixed(2)} ${currency}`
  }
}

export const jsonBody = value => ({ body: JSON.stringify(value) })
