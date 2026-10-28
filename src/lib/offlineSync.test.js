import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api, auth, flushOfflineTransactions, readCached } from './api'
import { discardOfflineTransaction, listOfflineQueue, setOfflineUser, syncOfflineQueue } from './offlineSync'
import {deleteOffline} from './offlineStore'

const records = vi.hoisted(() => new Map())
vi.mock('./offlineStore', () => ({
  readOffline: vi.fn(async key => records.get(key)),
  writeOffline: vi.fn(async (key, value) => { records.set(key, value) }),
  deleteOffline: vi.fn(async key => { records.delete(key) }),
  updateOffline: vi.fn(async (key, update) => {
    const value = update(records.get(key))
    if (value === undefined) records.delete(key)
    else records.set(key, value)
    return value
  }),
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
  it('does not post a later batch entry discarded while the first is in flight', async () => {
    setOfflineUser(4)
    for (const id of ['first', 'second']) records.set(`queue:4:${id}`, {
      id, key:id, path:'/api/transactions', body:JSON.stringify({description:id}), status:'pending', attempted:false,
    })
    let release, started
    const entered = new Promise(resolve => { started = resolve })
    const send = vi.fn(() => { started(); return new Promise(resolve => { release = resolve }) })
    const sync = syncOfflineQueue(send, 'synthetic', 4)
    await entered
    await discardOfflineTransaction('second', 4)
    await expect(discardOfflineTransaction('first', 4)).rejects.toThrow('may already have reached')
    release()
    await sync
    expect(send).toHaveBeenCalledTimes(1)
    expect(await listOfflineQueue(4)).toEqual([])
  })

  it('preserves an uncertain committed save and retries with its original key', async () => {
    setOfflineUser(4)
    records.set('queue:4:entry', {id:'entry',key:'original',path:'/api/transactions',body:'{}',status:'pending',attempted:false})
    const committed = new Set()
    const send = vi.fn(async (_path, options) => {
      committed.add(options.headers.get('Idempotency-Key'))
      if (send.mock.calls.length === 1) throw Object.assign(new Error('Lost response'), {network:true})
    })
    await syncOfflineQueue(send, 'synthetic', 4)
    await expect(discardOfflineTransaction('entry', 4)).rejects.toThrow('cannot undo a server save')
    expect(await listOfflineQueue(4)).toHaveLength(1)
    await syncOfflineQueue(send, 'synthetic', 4)
    expect([...committed]).toEqual(['original'])
    expect(await listOfflineQueue(4)).toEqual([])
  })

  it('keeps initial online attempts uncertain even when connectivity drops before fallback', async () => {
    setOfflineUser(4)
    auth.token = 'synthetic'
    vi.stubGlobal('fetch', vi.fn(async () => {
      vi.stubGlobal('navigator', {onLine:false})
      throw new TypeError('Lost response')
    }))
    await api('/api/transactions', {method:'POST',body:'{"amount":8}'})
    const [row] = await listOfflineQueue(4)
    expect(row.attempted).toBe(true)
    await expect(discardOfflineTransaction(row.id, 4)).rejects.toThrow('may already have reached')
  })

  it('allows a never-attempted offline save to be discarded without any POST', async () => {
    setOfflineUser(4)
    auth.token = 'synthetic'
    vi.stubGlobal('navigator', {onLine:false})
    vi.stubGlobal('fetch', vi.fn())
    const saved = await api('/api/transactions', {method:'POST',body:'{"amount":9}'})
    await discardOfflineTransaction(saved.offline_id, 4)
    expect(await listOfflineQueue(4)).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps an unconfirmed queued write pending when its account signs out', async () => {
    setOfflineUser(4)
    const record={id:'pending',key:'stable-key',path:'/api/transactions',body:'{}',status:'pending'}
    records.set('queue:4:pending',record)
    const send=vi.fn(async()=>{setOfflineUser(5);throw Object.assign(new Error('Account changed'),{staleAuth:true})})
    await syncOfflineQueue(send,'synthetic-token',4)
    expect(await listOfflineQueue(4)).toEqual([{...record, attempted:true}])
    expect(await listOfflineQueue(5)).toEqual([])
  })

  it('does not announce another account’s completed sync after local deletion', async () => {
    setOfflineUser(4)
    records.set('queue:4:pending',{id:'pending',key:'stable-key',path:'/api/transactions',body:'{}',status:'pending'})
    deleteOffline.mockImplementationOnce(async key=>{records.delete(key);setOfflineUser(5)})
    const synced=vi.fn()
    window.addEventListener('budgetly:offline-synced',synced)
    try{
      await syncOfflineQueue(vi.fn(async()=>({id:1})),'synthetic-token',4)
      expect(synced).not.toHaveBeenCalled()
      expect(await listOfflineQueue(4)).toEqual([])
    }finally{window.removeEventListener('budgetly:offline-synced',synced)}
  })

  it('retains a transaction with its original key when a success response is truncated', async () => {
    setOfflineUser(4)
    auth.token = 'signed-in'
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => { throw new SyntaxError('Truncated JSON') } })
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ id: 40 }) }))
    expect(await api('/api/transactions', { method: 'POST', body: JSON.stringify({ amount: 18 }) })).toMatchObject({ queued: true })
    const [row] = await listOfflineQueue(4)
    expect(row.key).toBe(fetch.mock.calls[0][1].headers.get('Idempotency-Key'))
    await flushOfflineTransactions()
    expect(fetch.mock.calls[1][1].headers.get('Idempotency-Key')).toBe(row.key)
    expect(await listOfflineQueue(4)).toEqual([])
  })

  it('does not queue an in-flight write under a newly signed-in account', async () => {
    setOfflineUser(4)
    auth.token = 'first-account'
    let reject
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve, fail) => { reject = fail })))
    const request = api('/api/transactions', { method: 'POST', body: JSON.stringify({ amount: 19 }) })
    const rejected = expect(request).rejects.toMatchObject({ staleAuth: true })
    setOfflineUser(5)
    auth.token = 'second-account'
    reject(new TypeError('Connection lost'))
    await rejected
    expect(await listOfflineQueue(4)).toEqual([])
    expect(await listOfflineQueue(5)).toEqual([])
  })

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

describe('in-flight account isolation', () => {
  it.each(['headers', 'body', 'offline user only'])('rejects stale GET data during %s without caching or announcing availability', async stage => {
    auth.token = 'account-a'
    setOfflineUser(4)
    let release
    let started
    const bodyStarted = new Promise(resolve => { started = resolve })
    const oldData = [{ id: 4, name: 'Private A wallet' }]
    const json = vi.fn(() => { started(); return new Promise(resolve => { release = () => resolve(oldData) }) })
    vi.stubGlobal('fetch', vi.fn(stage === 'body'
      ? async () => ({ ok: true, status: 200, json })
      : () => new Promise(resolve => { release = () => resolve({ ok: true, status: 200, json }) })))
    const available = vi.fn()
    window.addEventListener('budgetly:service-available', available)
    try {
      const request = api('/api/wallets')
      const rejected = expect(request).rejects.toMatchObject({ staleAuth: true })
      if (stage === 'body') await bodyStarted
      if (stage !== 'offline user only') auth.token = 'account-b'
      setOfflineUser(5)
      release()
      await rejected
      expect(readCached('/api/wallets')).toBeUndefined()
      expect([...records.keys()].filter(key => key.startsWith('cache:'))).toEqual([])
      expect(available).not.toHaveBeenCalled()
      if (stage !== 'body') expect(json).not.toHaveBeenCalled()
      expect(fetch.mock.calls[0][1].headers.get('Authorization')).toBe('Bearer account-a')
    } finally { window.removeEventListener('budgetly:service-available', available) }
  })

  it('does not resend a 428 mutation as the account that signs in during confirmation', async () => {
    auth.token = 'account-a'
    setOfflineUser(4)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 428, json: async () => ({ detail: 'Confirm password' }) }))
    let confirm
    let opened
    const prompt = new Promise(resolve => { opened = resolve })
    const listener = event => { confirm = event.detail.resolve; opened() }
    window.addEventListener('flowbudget:confirm-password', listener)
    try {
      const request = api('/api/wallets', { method: 'POST', body: JSON.stringify({ name: 'A wallet' }) })
      const rejected = expect(request).rejects.toMatchObject({ staleAuth: true })
      await prompt
      auth.token = 'account-b'
      setOfflineUser(5)
      confirm()
      await rejected
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(await listOfflineQueue(5)).toEqual([])
    } finally { window.removeEventListener('flowbudget:confirm-password', listener) }
  })

  it('does not let a stale 204 write clear the new account’s wallet cache', async () => {
    auth.token = 'account-a'
    setOfflineUser(4)
    let completeOld
    const wallets = [{ id: 5, name: 'B wallet' }]
    vi.stubGlobal('fetch', vi.fn()
      .mockImplementationOnce(() => new Promise(resolve => { completeOld = resolve }))
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => wallets }))
    const request = api('/api/transactions/4', { method: 'DELETE' })
    const rejected = expect(request).rejects.toMatchObject({ staleAuth: true })
    auth.token = 'account-b'
    setOfflineUser(5)
    await api('/api/wallets')
    expect(readCached('/api/wallets')).toEqual(wallets)
    completeOld({ ok: true, status: 204 })
    await rejected
    expect(readCached('/api/wallets')).toEqual(wallets)
  })

  it('resends after password confirmation when the account is unchanged', async () => {
    auth.token = 'account-a'
    setOfflineUser(4)
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 428, json: async () => ({ detail: 'Confirm password' }) })
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ id: 4 }) }))
    const listener = event => event.detail.resolve()
    window.addEventListener('flowbudget:confirm-password', listener)
    try {
      expect(await api('/api/wallets', { method: 'POST', body: JSON.stringify({ name: 'Confirmed wallet' }) })).toEqual({ id: 4 })
      expect(fetch).toHaveBeenCalledTimes(2)
      expect(fetch.mock.calls[1][1].headers.get('Authorization')).toBe('Bearer account-a')
      expect(fetch.mock.calls[1][1].headers.get('Idempotency-Key')).toBe(fetch.mock.calls[0][1].headers.get('Idempotency-Key'))
    } finally { window.removeEventListener('flowbudget:confirm-password', listener) }
  })

  it('allows an anonymous login caller to install its token after receiving the response', async () => {
    const credentials = { access_token: 'new-session' }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => credentials }))
    const result = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'local@example.test' }) })
    auth.token = result.access_token
    setOfflineUser(4)
    expect(result).toEqual(credentials)
    expect(auth.token).toBe('new-session')
    expect(fetch.mock.calls[0][1].headers.has('Authorization')).toBe(false)
  })
})
