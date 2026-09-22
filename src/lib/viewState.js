import { useCallback, useState } from 'react'

export function readView(key, fallback) {
  try { return JSON.parse(sessionStorage.getItem(`budgetly:view:${key}`)) ?? fallback }
  catch { return fallback }
}
export function writeView(key, value) {
  try { sessionStorage.setItem(`budgetly:view:${key}`, JSON.stringify(value)) } catch { /* Navigation remains usable without storage. */ }
}
export function useViewState(key, initial, override) {
  const [value, setValue] = useState(() => override ?? readView(key, initial))
  const update = useCallback(next => setValue(previous => {
    const resolved = typeof next === 'function' ? next(previous) : next
    writeView(key, resolved)
    return resolved
  }), [key])
  return [value, update]
}
