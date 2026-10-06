import { useEffect, useState } from 'react'

export const preferenceEvent = 'budgetly:workspace-preferences'
export const secondaryPages = [
  ['/planner','Planner','Planning'],
  ['/upcoming','Upcoming','Planning'], ['/attention','Attention','Planning'], ['/calendar','Calendar','Planning'], ['/budgets','Budgets','Planning'], ['/goals','Goals & debts','Planning'], ['/analytics','Analytics','Planning'],
  ['/ask-ai','Ask Budgetly','Workspace'], ['/notes','Notes','Workspace'], ['/bank-messages','Bank messages','Workspace'], ['/feedback','Feedback','Workspace'],
]
const defaults = () => ({ rememberEntry: true, descriptionSuggestions: true, entryTemplates: true, balancePreview: true, recentChoiceOrder: true, personalizedShortcuts: true, weeklySummary: true, goalCelebrations: true, favoriteWallets: [], navOrder: secondaryPages.map(([path]) => path), notesView: 'grid' })
const key = userId => `budgetly:workspace:v1:${userId}`
export function readWorkspacePreferences(userId) {
  try {
    const stored = JSON.parse(localStorage.getItem(key(userId))) || {}
    const valid = defaults()
    return { ...valid, rememberEntry: stored.rememberEntry !== false, descriptionSuggestions: stored.descriptionSuggestions !== false, entryTemplates: stored.entryTemplates !== false, balancePreview: stored.balancePreview !== false, recentChoiceOrder: stored.recentChoiceOrder !== false, notesView: stored.notesView === 'list' ? 'list' : 'grid',
      personalizedShortcuts: stored.personalizedShortcuts !== false, weeklySummary: stored.weeklySummary !== false, goalCelebrations: stored.goalCelebrations !== false,
      favoriteWallets: Array.isArray(stored.favoriteWallets) ? [...new Set(stored.favoriteWallets.filter(id => Number.isInteger(id) && id > 0))].slice(0,100) : [],
      navOrder: [...new Set([...(Array.isArray(stored.navOrder) ? stored.navOrder : []), ...valid.navOrder])].filter(path => valid.navOrder.includes(path)) }
  } catch { return defaults() }
}
export function saveWorkspacePreferences(userId, patch) {
  if (!userId) return
  try { localStorage.setItem(key(userId), JSON.stringify({ ...readWorkspacePreferences(userId), ...patch })) }
  catch { return false }
  window.dispatchEvent(new CustomEvent(preferenceEvent, { detail: { userId } }))
  return true
}
export function useWorkspacePreferences(userId) {
  const [value, setValue] = useState(() => readWorkspacePreferences(userId))
  useEffect(() => {
    const update = () => setValue(readWorkspacePreferences(userId))
    update(); window.addEventListener(preferenceEvent, update); window.addEventListener('storage', update)
    return () => { window.removeEventListener(preferenceEvent, update); window.removeEventListener('storage', update) }
  }, [userId])
  return [value, patch => saveWorkspacePreferences(userId, patch)]
}

const entryKey = (userId, scope) => `budgetly:entry:v1:${userId}:${scope}`
export function recentEntries(userId, scope) {
  if (!userId || !readWorkspacePreferences(userId).rememberEntry) return []
  try {
    const saved = JSON.parse(localStorage.getItem(entryKey(userId,scope)))
    if (!Number.isFinite(saved?.savedAt) || Date.now() - saved.savedAt > 30 * 86400000) return []
    return Array.isArray(saved?.entries) ? saved.entries.filter(entry => ['expense','income'].includes(entry.type) && typeof entry.description === 'string').slice(0,8) : []
  } catch { return [] }
}
export function rememberEntry(userId, scope, entry) {
  if (!userId || !readWorkspacePreferences(userId).rememberEntry || entry.type === 'transfer') return
  const previous=recentEntries(userId,scope).find(item=>item.type===entry.type && item.description===String(entry.description||'').trim() && String(item.wallet_id)===String(entry.wallet_id))
  const item = { type: entry.type, wallet_id: entry.wallet_id, category_id: entry.category_id || '', description: String(entry.description || '').trim().slice(0,160), uses:Math.min(1000,(Number.isInteger(previous?.uses)?previous.uses:0)+1) }
  const entries = [item, ...recentEntries(userId,scope).filter(previous => !(previous.type === item.type && previous.description === item.description && previous.wallet_id === item.wallet_id))].slice(0,8)
  try { localStorage.setItem(entryKey(userId,scope), JSON.stringify({ savedAt: Date.now(), entries })) } catch { /* Entry still succeeds without preferences storage. */ }
}
export function clearEntryMemory(userId) {
  for (const scope of ['personal','shared']) { try { localStorage.removeItem(entryKey(userId,scope)) } catch { /* Optional storage. */ } }
}
