import { useSyncExternalStore } from 'react'

const key = 'budgetly_welcome_animation'
const event = 'budgetly:welcome-animation'
export const welcomeSpeeds = [
  { value: 2, label: 'Quick · 2 seconds' },
  { value: 3.5, label: 'Natural · 3.5 seconds' },
  { value: 5, label: 'Relaxed · 5 seconds' },
  { value: 6, label: 'Slow · 6 seconds' },
]
export function readWelcomeSpeed() {
  try {
    const value = Number(localStorage.getItem(key))
    return welcomeSpeeds.some(speed => speed.value === value) ? value : 3.5
  } catch { return 3.5 }
}
export function saveWelcomeSpeed(value) {
  if (!welcomeSpeeds.some(speed => speed.value === value)) throw new Error('Choose one of the greeting speeds.')
  localStorage.setItem(key, String(value))
  window.dispatchEvent(new Event(event))
}
function subscribe(listener) {
  window.addEventListener(event, listener)
  window.addEventListener('storage', listener)
  return () => { window.removeEventListener(event, listener); window.removeEventListener('storage', listener) }
}
export const useWelcomeSpeed = () => useSyncExternalStore(subscribe, readWelcomeSpeed, () => 3.5)
