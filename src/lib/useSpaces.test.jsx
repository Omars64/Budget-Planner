import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import useSpaces from './useSpaces'
import { scopedPath } from './spaces'

vi.mock('./api', () => ({ api: vi.fn(async () => [{ id: 7, name: 'Home' }, { id: 8, name: 'Trip' }]), hasPendingWrites: () => false }))
vi.mock('./deletedSpaceCache', () => ({ clearDeletedSpaceCache: vi.fn(async () => {}) }))
const wrapper = ({ children }) => <MemoryRouter>{children}</MemoryRouter>
afterEach(() => { cleanup(); sessionStorage.clear() })

it('returns an active deleted Space to Personal and removes its persisted selection immediately', async () => {
  sessionStorage.setItem('budgetly_active_space_42', '7')
  const user = { id: 42, role: 'user' }
  const notify = vi.fn(), confirm = vi.fn()
  const { result } = renderHook(() => useSpaces(user, notify, confirm), { wrapper })
  await waitFor(() => expect(result.current.activeSpace?.id).toBe(7))
  act(() => result.current.forgetDeletedSpace(7))
  expect(result.current.activeSpace).toBeNull()
  expect(result.current.spaces.map(row => row.id)).toEqual([8])
  expect(sessionStorage.getItem('budgetly_active_space_42')).toBeNull()
  expect(scopedPath('/api/transactions')).toBe('/api/transactions?space_id=personal')
})

it('deleting another listed Space leaves the current Space selected', async () => {
  sessionStorage.setItem('budgetly_active_space_42', '7')
  const user = { id: 42, role: 'user' }
  const notify = vi.fn(), confirm = vi.fn()
  const { result } = renderHook(() => useSpaces(user, notify, confirm), { wrapper })
  await waitFor(() => expect(result.current.activeSpace?.id).toBe(7))
  act(() => result.current.forgetDeletedSpace(8))
  expect(result.current.activeSpace.id).toBe(7)
  expect(result.current.spaces.map(row => row.id)).toEqual([7])
})
