import { beforeEach, expect, it, vi } from 'vitest'
import { clearDeletedSpaceCache } from './deletedSpaceCache'
import { deleteOffline, listOffline, updateOffline } from './offlineStore'
vi.mock('./offlineStore', () => ({ deleteOffline: vi.fn(async () => {}), listOffline: vi.fn(), updateOffline: vi.fn(async () => {}) }))
beforeEach(() => vi.clearAllMocks())
it('removes only deleted/aggregate cached data and filters the cached Space list', async () => {
  listOffline.mockResolvedValue(['/api/spaces', '/api/wallets?space_id=7', '/api/wallets?space_id=8', '/api/wallets?space_id=personal', '/api/planned-transactions?space_id='].map(path => ({ key: `cache:42:${path}` })))
  await clearDeletedSpaceCache(42, 7)
  expect(listOffline).toHaveBeenCalledWith('cache:42:')
  expect(deleteOffline.mock.calls.flat()).toEqual(['cache:42:/api/wallets?space_id=7', 'cache:42:/api/planned-transactions?space_id='])
  const [key, update] = updateOffline.mock.calls[0]
  expect(key).toBe('cache:42:/api/spaces')
  expect(update({ savedAt: 4, data: [{ id: 7 }, { id: 8 }] })).toEqual({ savedAt: 4, data: [{ id: 8 }] })
})
