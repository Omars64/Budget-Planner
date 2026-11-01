import { deleteOffline, listOffline, updateOffline } from './offlineStore'

// Only cached responses are removed. Pending transactions and drafts are retained
// with their original Space IDs; they must never be redirected into Personal.
export async function clearDeletedSpaceCache(userId, spaceId) {
  const prefix = `cache:${userId}:`
  const rows = await listOffline(prefix)
  await Promise.all(rows.map(({ key }) => {
    const path = key.slice(prefix.length)
    if (path === '/api/spaces') return updateOffline(key, current => current && Array.isArray(current.data)
      ? { ...current, data: current.data.filter(space => space.id !== spaceId) } : undefined)
    const url = new URL(path, 'https://budgetly.local')
    const scope = url.searchParams.get('space_id')
    // Aggregated/unscoped financial caches may contain rows from the deleted Space.
    if (scope === String(spaceId) || scope === '' || scope === null) return deleteOffline(key)
  }))
}
