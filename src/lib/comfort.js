import { Capacitor, registerPlugin } from '@capacitor/core'

const key = 'budgetly:comfort'
export const comfortEvent = 'budgetly:comfort-changed'
const Feedback = registerPlugin('BudgetlyFeedback')
export function readComfort() {
  try { const value = JSON.parse(localStorage.getItem(key)); return { motion:['system','full','reduced','off'].includes(value?.motion) ? value.motion : 'system', haptics:value?.haptics === true } }
  catch { return { motion:'system', haptics:false } }
}
export function saveComfort(value) {
  localStorage.setItem(key, JSON.stringify(value))
  window.dispatchEvent(new window.Event(comfortEvent))
}
export function effectiveMotion(value = readComfort().motion) {
  return value === 'system' ? (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'reduced' : 'full') : value
}
export function successHaptic() {
  if (readComfort().haptics && Capacitor.isNativePlatform()) void Feedback.success().catch(() => {})
}
