import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { api } from './api'
import useLedger from './useLedger'
import { defaultLedgerFilters } from '../components/LedgerFilters'
import { updateResourcePolicy } from './resourcePolicy'

vi.mock('./api', () => ({ api: vi.fn(), readCached: () => undefined }))
beforeEach(() => vi.clearAllMocks())
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); updateResourcePolicy({client_poll_seconds:60}) })

test('restores the page for the same account and filter after navigating away', async () => {
  sessionStorage.clear()
  api.mockResolvedValue(Array.from({length:101},(_,id)=>({id})))
  const first = renderHook(()=>useLedger('/api/transactions',defaultLedgerFilters,0,false,'personal:41'))
  await waitFor(()=>expect(first.result.current.hasMore).toBe(true))
  act(()=>first.result.current.next())
  await waitFor(()=>expect(first.result.current.page).toBe(2))
  first.unmount()
  const restored = renderHook(()=>useLedger('/api/transactions',defaultLedgerFilters,0,false,'personal:41'))
  expect(restored.result.current.page).toBe(2)
  const other = renderHook(()=>useLedger('/api/transactions',defaultLedgerFilters,0,false,'personal:42'))
  expect(other.result.current.page).toBe(1)
})

test('paginates and resets to the first page when a wallet or month changes', async () => {
  api.mockResolvedValue(Array.from({length: 101}, (_, id) => ({ id })))
  const { result, rerender } = renderHook(({ filters }) => useLedger('/api/transactions', filters, 0), {initialProps: {filters: defaultLedgerFilters}})
  await waitFor(() => expect(result.current.rows).toHaveLength(100))
  expect(result.current.hasMore).toBe(true)
  act(() => result.current.next())
  await waitFor(() => expect(api.mock.lastCall[0]).toContain('offset=100'))
  rerender({filters: {...defaultLedgerFilters, wallet: '2', month: '2026-09'}})
  await waitFor(() => expect(api.mock.lastCall[0]).toContain('wallet_id=2&month=2026-09'))
  expect(api.mock.lastCall[0]).toContain('offset=0')
  expect(result.current.page).toBe(1)
})

test('ignores responses from an old filter after the selected wallet changes', async () => {
  let finishOld
  api.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve })).mockResolvedValue([{id: 'new-wallet'}])
  const { result, rerender } = renderHook(({ filters }) => useLedger('/api/shared/transactions', filters, 0), {initialProps: {filters: defaultLedgerFilters}})
  await waitFor(() => expect(api).toHaveBeenCalledOnce())
  rerender({filters: {...defaultLedgerFilters, wallet: '2'}})
  await waitFor(() => expect(result.current.rows).toEqual([{id: 'new-wallet'}]))
  await act(async () => finishOld([{id: 'old-wallet'}]))
  expect(result.current.rows).toEqual([{id: 'new-wallet'}])
})

test('keeps the current records on a temporary refresh failure and allows retry', async () => {
  api.mockResolvedValueOnce([{id: 1}]).mockRejectedValueOnce(new Error('Offline')).mockResolvedValue([{id: 2}])
  const { result, rerender } = renderHook(({ refresh }) => useLedger('/api/shared/transactions', defaultLedgerFilters, refresh), {initialProps: {refresh: 0}})
  await waitFor(() => expect(result.current.rows).toEqual([{id: 1}]))
  rerender({refresh: 1})
  await waitFor(() => expect(result.current.error).toBe('Offline'))
  expect(result.current.rows).toEqual([{id: 1}])
  act(() => result.current.retry())
  await waitFor(() => expect(result.current.rows).toEqual([{id: 2}]))
  expect(result.current.error).toBe('')
})

test('adapts recurring ledger reads without focus storms and refreshes filters and retries immediately', async () => {
  vi.useFakeTimers()
  api.mockResolvedValue([{id:1}])
  const { result, rerender } = renderHook(({filters, refresh}) => useLedger('/api/shared/transactions', filters, refresh, true), {initialProps:{filters:defaultLedgerFilters,refresh:0}})
  await act(async () => vi.advanceTimersByTimeAsync(180))
  expect(api).toHaveBeenCalledTimes(1)
  act(() => updateResourcePolicy({client_poll_seconds:15}))
  await act(async () => vi.advanceTimersByTimeAsync(15000))
  expect(api).toHaveBeenCalledTimes(2)
  for (let i=0;i<10;i++) window.dispatchEvent(new Event('focus'))
  await act(async () => vi.advanceTimersByTimeAsync(0))
  expect(api).toHaveBeenCalledTimes(2)
  rerender({filters:{...defaultLedgerFilters,wallet:'2'},refresh:0})
  await act(async () => vi.advanceTimersByTimeAsync(180))
  expect(api).toHaveBeenCalledTimes(3)
  rerender({filters:{...defaultLedgerFilters,wallet:'2'},refresh:1})
  await act(async () => vi.advanceTimersByTimeAsync(180))
  expect(api).toHaveBeenCalledTimes(4)
  act(() => result.current.retry())
  await act(async () => vi.advanceTimersByTimeAsync(180))
  expect(api).toHaveBeenCalledTimes(5)
})

test('clears permission-denied records instead of preserving a previous successful result', async () => {
  api.mockResolvedValueOnce([{id:'private'}]).mockRejectedValue(Object.assign(new Error('Forbidden'),{status:403}))
  const { result, rerender } = renderHook(({refresh}) => useLedger('/api/shared/transactions', defaultLedgerFilters, refresh, true),{initialProps:{refresh:0}})
  await waitFor(() => expect(result.current.rows).toHaveLength(1))
  rerender({refresh:1})
  await waitFor(() => expect(result.current.error).toBe('Forbidden'))
  expect(result.current.rows).toEqual([])
})

test('does not retain another account view while the same endpoint reloads', async () => {
  api.mockResolvedValueOnce([{id:'account-one'}]).mockRejectedValue(new Error('Unavailable'))
  const { result, rerender } = renderHook(({view}) => useLedger('/api/shared/transactions',defaultLedgerFilters,0,true,view),{initialProps:{view:'shared:1'}})
  await waitFor(() => expect(result.current.rows).toHaveLength(1))
  rerender({view:'shared:2'})
  expect(result.current.rows).toEqual([])
  await waitFor(() => expect(result.current.error).toBe('Unavailable'))
  expect(result.current.rows).toEqual([])
})
