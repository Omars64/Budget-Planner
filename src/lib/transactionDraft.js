const week = 7 * 24 * 60 * 60 * 1000
export function readDraft(key) {
  try {
    const session = JSON.parse(sessionStorage.getItem(key))
    if (session && typeof session === 'object') return session
    const saved = JSON.parse(localStorage.getItem(key))
    if (saved?.data && Date.now() - saved.savedAt < week) return saved.data
    localStorage.removeItem(key)
  } catch { /* Storage is best effort, never a condition for entry. */ }
  return null
}
export function writeDraft(key, data) {
  try { sessionStorage.setItem(key, JSON.stringify(data)) } catch { /* Try durable storage too. */ }
  try { localStorage.setItem(key, JSON.stringify({savedAt:Date.now(),data})) } catch { /* The in-memory form remains usable. */ }
}
export function clearDraft(key) {
  try { sessionStorage.removeItem(key) } catch { /* Optional storage. */ }
  try { localStorage.removeItem(key) } catch { /* Optional storage. */ }
}
