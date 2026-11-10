import { useEffect, useState } from 'react'

const changed = 'budgetly:notifications-seen'
const memory = new Map()
const empty = { attention: [], bank: 0 }
const storageKey = (userId, spaceKey) => userId ? `budgetly:notification-reads:${userId}:${spaceKey || 'personal'}` : null

function read(key) {
  if (!key) return empty
  try {
    const value = JSON.parse(localStorage.getItem(key))
    if (Array.isArray(value?.attention) && Number.isSafeInteger(value.bank)) return value
    return memory.get(key) || empty
  } catch { return memory.get(key) || empty }
}

export function attentionKeys(items = [], generatedAt = '') {
  return items.map(row => JSON.stringify([row.id, row.severity, row.date || row.due_at || generatedAt.slice(0, 7)]))
}

export function markNotificationsSeen(userId, spaceKey, { attention = [], bank = 0 }) {
  const key = storageKey(userId, spaceKey)
  if (!key) return
  const previous = read(key)
  if (bank <= previous.bank && attention.every(id => previous.attention.includes(id))) return
  const next = { bank:Math.max(previous.bank, bank), attention:[...new Set([...previous.attention, ...attention])].slice(-1000) }
  memory.set(key, next)
  try { localStorage.setItem(key, JSON.stringify(next)) } catch { /* The current tab still remembers the viewed items. */ }
  window.dispatchEvent(new CustomEvent(changed, { detail:key }))
}

export function useNotificationReads(userId, spaceKey) {
  const key = storageKey(userId, spaceKey)
  const [seen, setSeen] = useState(() => ({ key, value:read(key) }))
  useEffect(() => {
    const update = event => {
      if (event.detail === key || event.key === key || event.key === null) setSeen({ key, value:read(key) })
    }
    window.addEventListener(changed, update)
    window.addEventListener('storage', update)
    return () => { window.removeEventListener(changed, update); window.removeEventListener('storage', update) }
  }, [key])
  return seen.key === key ? seen.value : read(key)
}
