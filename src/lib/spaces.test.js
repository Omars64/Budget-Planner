import { afterEach, expect, it } from 'vitest'
import { scopedPath, setApiSpace, readSpaceSelection, rememberSpaceSelection } from './spaces'

afterEach(() => { setApiSpace(null); sessionStorage.clear() })

it('isolates financial requests but leaves account and admin requests alone', () => {
  setApiSpace(17)
  expect(scopedPath('/api/transactions?month=2026-10')).toBe('/api/transactions?month=2026-10&space_id=17')
  expect(scopedPath('/api/wallets/2')).toBe('/api/wallets/2?space_id=17')
  expect(scopedPath('/api/settings')).toBe('/api/settings')
  expect(scopedPath('/api/admin/users')).toBe('/api/admin/users')
  expect(scopedPath('/api/backup')).toBe('/api/backup')
})

it('keeps a queued request in its original space after switching', () => {
  setApiSpace(17)
  const queued = scopedPath('/api/transactions')
  setApiSpace(18)
  expect(scopedPath(queued)).toBe('/api/transactions?space_id=17')
  setApiSpace(null)
  expect(scopedPath('/api/transactions')).toBe('/api/transactions?space_id=personal')
  expect(scopedPath('/api/planned-transactions?space_id=')).toBe('/api/planned-transactions?space_id=')
})

it('remembers context only for the matching account session', () => {
  rememberSpaceSelection(1, 17)
  expect(readSpaceSelection(1)).toBe(17)
  expect(readSpaceSelection(2)).toBeNull()
  rememberSpaceSelection(1, null)
  expect(readSpaceSelection(1)).toBeNull()
})
