import { useSyncExternalStore } from 'react'
import { successHaptic } from './comfort'

let saved = null
let timer
const listeners = new Set()
const emit = () => listeners.forEach(listener => listener())
export const transactionRecordedEvent = 'budgetly:transaction-recorded'
export function transactionSaved(transaction, context) {
  if (!transaction?.id) return
  saved = transaction.id
  emit()
  if (context) window.dispatchEvent(new CustomEvent(transactionRecordedEvent, { detail: { transaction, ...context } }))
  successHaptic()
  window.clearTimeout(timer)
  timer = window.setTimeout(() => { saved = null; emit() }, 4500)
}
const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener) }
export function useSavedTransaction() { return useSyncExternalStore(subscribe, () => saved, () => null) }
