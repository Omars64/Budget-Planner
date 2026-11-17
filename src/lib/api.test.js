import { describe, expect, it, vi } from 'vitest'
import { api, apiFile, auth, money, sessionExpiredEvent } from './api'

describe('money formatter', () => {
  it('formats KWD using three fractional digits', () => {
    const value = money(12.5, 'KWD')
    expect(value).toContain('12.500')
  })
  it('falls back safely for an invalid currency', () => {
    expect(money(10, 'NOTREAL')).toContain('10.00')
  })
})

it('coalesces repeated submits while a request is pending', async () => {
  let resolve
  const fetchMock = vi.fn(() => new Promise(done => { resolve = done }))
  vi.stubGlobal('fetch', fetchMock)
  try {
    const options = { method: 'POST', body: JSON.stringify({ amount: 1 }) }
    const first = api('/api/transactions', options)
    const second = api('/api/transactions', options)
    expect(first).toBe(second)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1].headers.get('Idempotency-Key')).toBeTruthy()
    resolve({ ok: true, status: 201, json: async () => ({ id: 5 }) })
    expect(await second).toEqual({ id: 5 })
  } finally { vi.unstubAllGlobals() }
})

it('keeps the token across browser or Android restarts only when explicitly enabled', () => {
  sessionStorage.clear()
  localStorage.clear()
  auth.setRemembered(false)
  auth.token = 'temporary-token'
  expect(sessionStorage.getItem('flowbudget_token')).toBe('temporary-token')
  expect(localStorage.getItem('flowbudget_token')).toBeNull()
  auth.clear()
  expect(auth.token).toBe('')

  auth.setRemembered(true)
  auth.token = 'persistent-token'
  sessionStorage.clear()
  expect(auth.token).toBe('persistent-token')
  auth.clear()
  expect(auth.token).toBe('')
  expect(localStorage.getItem('flowbudget_remember_session')).toBe('true')
})

it('removing keep-me-signed-in deletes the persisted token', () => {
  localStorage.setItem('flowbudget_remember_session', 'true')
  localStorage.setItem('flowbudget_token', 'old-token')
  auth.setRemembered(false)
  expect(auth.token).toBe('')
  expect(localStorage.getItem('flowbudget_token')).toBeNull()
})

it('rejects an unconfirmed save and reuses its key on retry', async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ ok: true, status: 201, json: async () => { throw new SyntaxError('Truncated JSON') } })
    .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ id: 6 }) })
  vi.stubGlobal('fetch', fetchMock)
  try {
    const options = { method: 'POST', body: JSON.stringify({ name: 'Retry wallet' }) }
    await expect(api('/api/wallets', options)).rejects.toMatchObject({ network: true })
    expect(await api('/api/wallets', options)).toEqual({ id: 6 })
    expect(fetchMock.mock.calls[1][1].headers.get('Idempotency-Key')).toBe(fetchMock.mock.calls[0][1].headers.get('Idempotency-Key'))
  } finally { vi.unstubAllGlobals() }
})

it('preserves explicit retry keys and does not coalesce distinct logical saves', async () => {
  const releases = []
  const fetchMock = vi.fn(() => new Promise(resolve => releases.push(resolve)))
  vi.stubGlobal('fetch', fetchMock)
  try {
    const first = api('/api/wallets', {method:'POST',body:'{"name":"Same name"}',headers:{'Idempotency-Key':'logical-first'}})
    const second = api('/api/wallets', {method:'POST',body:'{"name":"Same name"}',headers:{'Idempotency-Key':'logical-second'}})
    const count = fetchMock.mock.calls.length
    releases.forEach(resolve => resolve({ok:true,status:201,json:async()=>({id:1})}))
    await Promise.all([first, second])
    expect(count).toBe(2)
    expect(fetchMock.mock.calls.map(([,options])=>options.headers.get('Idempotency-Key'))).toEqual(['logical-first','logical-second'])
  } finally { vi.unstubAllGlobals() }
})

it('blocks further requests and reports an expired session once, including on file downloads', async () => {
  auth.token = 'expired-export-session'
  const expired = vi.fn()
  window.addEventListener(sessionExpiredEvent, expired)
  const fetchMock = vi.fn(async () => globalThis.Response.json({ detail: 'Session rejected' }, {
    status: 401, headers: { 'WWW-Authenticate': 'Bearer error="invalid_token"' },
  }))
  vi.stubGlobal('fetch', fetchMock)
  try {
    await expect(apiFile('/api/backup/export')).rejects.toMatchObject({ status: 401, sessionExpired: true })
    await expect(api('/api/wallets')).rejects.toMatchObject({ status: 401, sessionExpired: true })
    expect(expired).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(auth.expired).toBe(true)
  } finally {
    window.removeEventListener(sessionExpiredEvent, expired)
    auth.clear()
    vi.unstubAllGlobals()
  }
})

it('keeps a healthy session after an incorrect password or a late response from a previous session', async () => {
  auth.token = 'original-session'
  const expired = vi.fn()
  window.addEventListener(sessionExpiredEvent, expired)
  let rejectOldSession
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce(globalThis.Response.json({ detail: 'Incorrect password' }, { status: 401 }))
    .mockImplementationOnce(() => new Promise(resolve => { rejectOldSession = resolve })))
  try {
    await expect(api('/api/account/confirm', { method: 'POST' })).rejects.toMatchObject({ status: 401, message: 'Incorrect password' })
    const oldRequest = api('/api/dashboard')
    auth.token = 'new-session'
    rejectOldSession(globalThis.Response.json({ detail: 'Session expired' }, { status: 401 }))
    await expect(oldRequest).rejects.toMatchObject({ staleAuth: true })
    expect(expired).not.toHaveBeenCalled()
    expect(auth.expired).toBe(false)
    expect(auth.token).toBe('new-session')
  } finally {
    window.removeEventListener(sessionExpiredEvent, expired)
    auth.clear()
    vi.unstubAllGlobals()
  }
})
