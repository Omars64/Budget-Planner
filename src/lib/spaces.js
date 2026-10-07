export const SPACE_COLORS = [
  { key: 'green', label: 'Emerald', accent: '#267d75' },
  { key: 'blue', label: 'Ocean', accent: '#3158aa' },
  { key: 'yellow', label: 'Gold', accent: '#aa850e' },
  { key: 'pink', label: 'Rose', accent: '#aa4c79' },
  { key: 'lime', label: 'Lime', accent: '#66852b' },
  { key: 'violet', label: 'Violet', accent: '#7956aa' },
]

let selected = null
const routes = /^\/api\/(wallets|categories|transactions|budgets|goals|debts|dashboard|analytics|calendar|planned-transactions|planner|attention|notes|note-folders|ledger|shared)(\/|\?|$)/

export function setApiSpace(id) { selected = id == null ? null : Number(id) }
export function scopedPath(path) {
  if (!routes.test(path) && !path.startsWith('/api/backup/statement')) return path
  const url = new URL(path, 'https://budgetly.local')
  if (!url.searchParams.has('space_id')) url.searchParams.set('space_id', selected ?? 'personal')
  return `${url.pathname}${url.search}`
}
export function spaceStorageKey(userId) { return `budgetly_active_space_${userId}` }
export function readSpaceSelection(userId) {
  try { return Number(sessionStorage.getItem(spaceStorageKey(userId))) || null } catch { return null }
}
export function rememberSpaceSelection(userId, id) {
  try { id == null ? sessionStorage.removeItem(spaceStorageKey(userId)) : sessionStorage.setItem(spaceStorageKey(userId), String(id)) } catch { /* Session persistence is optional. */ }
}
