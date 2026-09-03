const tokenKey = 'flowbudget_token'

export const auth = {
  get token() { return sessionStorage.getItem(tokenKey) || '' },
  set token(value) { value ? sessionStorage.setItem(tokenKey, value) : sessionStorage.removeItem(tokenKey) },
  clear() { sessionStorage.removeItem(tokenKey) },
}

export async function api(path, options = {}) {
  const headers = new Headers(options.headers || {})
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  if (auth.token) headers.set('Authorization', `Bearer ${auth.token}`)
  const response = await fetch(path, { ...options, headers })
  if (response.status === 204) return null
  let data = null
  try { data = await response.json() } catch { data = null }
  if (!response.ok) {
    const message = data?.detail || `Request failed (${response.status})`
    const error = new Error(Array.isArray(message) ? message.map(x => x.msg).join(', ') : message)
    error.status = response.status
    throw error
  }
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
