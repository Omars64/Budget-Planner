import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api, auth, flushOfflineTransactions } from './api'
import { listOfflineQueue, setOfflineUser, syncOfflineQueue } from './offlineSync'

const records = vi.hoisted(() => new Map())
vi.mock('./offlineStore', () => ({
  readOffline: vi.fn(async key => records.get(key)),
  writeOffline: vi.fn(async (key, value) => { records.set(key, value) }),
  deleteOffline: vi.fn(async key => { records.delete(key) }),
  listOffline: vi.fn(async prefix => [...records.entries()].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, value }))),
  clearOfflineCache: vi.fn(async () => {}),
}))

beforeEach(() => {
  records.clear()
  setOfflineUser(null)
  auth.clear()
  vi.unstubAllGlobals()
})

describe('offline transaction sync', () => {
  it('keeps the same idempotency key after a lost response and only removes a confirmed write', async () => {
    setOfflineUser(4)
    auth.token = 'signed-in'
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('network lost')).mockResolvedValue({ ok: true, status: 201, json: async () => ({ id: 40 }) }))
    const result = await api('/api/transactions', { method: 'POST', body: JSON.stringify({ type: 'expense', amount: 2.25, description: 'Breakfast', wallet_id: 1 }) })
    expect(result.queued).toBe(true)
    const pending = await listOfflineQueue(4)
    expect(pending).toHaveLength(1)
    await flushOfflineTransactions()
    expect(await listOfflineQueue(4)).toHaveLength(0)
    expect(fetch.mock.calls[0][1].headers.get('Idempotency-Key')).toBe(pending[0].key)
    expect(fetch.mock.calls[1][1].headers.get('Idempotency-Key')).toBe(pending[0].key)
  })

  it('keeps rejected writes visible and isolates accounts', async () => {
    setOfflineUser(4)
    auth.token = 'signed-in'
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('offline')))
    await api('/api/shared/transactions', { method: 'POST', body: JSON.stringify({ type: 'income', amount: 10, description: 'Shared pay', wallet_id: 7 }) })
    expect(await listOfflineQueue(5)).toHaveLength(0)
    setOfflineUser(5)
    const send = vi.fn()
    await syncOfflineQueue(send, 'other-token')
    expect(send).not.toHaveBeenCalled()
    setOfflineUser(4)
    send.mockRejectedValue(Object.assign(new Error('Shared access removed'), { status: 403 }))
    await syncOfflineQueue(send, 'signed-in')
    expect((await listOfflineQueue(4))[0]).toMatchObject({ status: 'failed', error: 'Shared access removed' })
    await syncOfflineQueue(send, 'signed-in')
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('saves a draft locally when the API gateway is unavailable', async () => {
    setOfflineUser(4)
    auth.token = 'signed-in'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({ detail: 'Service unavailable' }) }))
    const result = await api('/api/transactions', { method: 'POST', body: JSON.stringify({ type: 'expense', amount: 2.25, description: 'Coffee', wallet_id: 1 }) })
    expect(result.queued).toBe(true)
    expect(await listOfflineQueue(4)).toHaveLength(1)
  })

  it('reads a previously loaded ledger during a service outage', async () => {
    setOfflineUser(4)
    auth.token = 'signed-in'
    const ledger = [{ id: 7, description: 'Saved record' }]
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ledger })
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ detail: 'Service unavailable' }) }))
    expect(await api('/api/transactions?month=2026-09')).toEqual(ledger)
    expect(await api('/api/transactions?month=2026-09')).toEqual(ledger)
  })
})
