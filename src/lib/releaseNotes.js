import notes from '../../release-notes.json'

export function validateReleaseNotes(value) {
  if (!Array.isArray(value) || value.length > 12) return []
  return value.filter(item => item && typeof item.title === 'string' && item.title.trim() && item.title.length <= 100 &&
    typeof item.detail === 'string' && item.detail.trim() && item.detail.length <= 350 &&
    (item.audience === undefined || item.audience === 'all' || item.audience === 'admin'))
    .map(({ title, detail, audience }) => ({ title, detail, ...(audience === 'admin' ? { audience } : {}) }))
}

export function releaseNotes(version, published, role = 'user') {
  const verified = validateReleaseNotes(published)
  const items = verified.length ? verified : validateReleaseNotes(notes[version])
  const visible = items.filter(item => item.audience !== 'admin' || role === 'admin')
  return visible.length || !items.length ? visible : [{ title: 'Reliability improvements', detail: 'Maintenance and bug fixes help keep Budgetly running smoothly.' }]
}

export const seenReleaseKey = userId => `budgetly-whats-new-v1:${userId}`
export function hasSeenRelease(userId, version) {
  try { return localStorage.getItem(seenReleaseKey(userId)) === version } catch { return false }
}
export function markReleaseSeen(userId, version) {
  try { localStorage.setItem(seenReleaseKey(userId), version) } catch { /* Storage may be unavailable in private browsing. */ }
}
