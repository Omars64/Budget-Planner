import { useSyncExternalStore } from 'react'
import { successHaptic } from './comfort'

let saved = null
let timer
const listeners = new Set()
const emit = () => listeners.forEach(listener => listener())
export function transactionSaved(transaction) {
  if (!transaction?.id) return
  saved = transaction.id
  emit()
  successHaptic()
  window.clearTimeout(timer)
  timer = window.setTimeout(() => { saved = null; emit() }, 4500)
}
const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener) }
export function useSavedTransaction() { return useSyncExternalStore(subscribe, () => saved, () => null) }
