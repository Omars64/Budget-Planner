import { describe, expect, it, vi } from 'vitest'
import { api, auth, money } from './api'

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
