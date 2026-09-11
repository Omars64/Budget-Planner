import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { api } from './api'
import useLedger from './useLedger'
import { defaultLedgerFilters } from '../components/LedgerFilters'

vi.mock('./api', () => ({ api: vi.fn(), readCached: () => undefined }))
beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

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
