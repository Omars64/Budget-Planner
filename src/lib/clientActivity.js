export const CLIENT_IDLE_MS = 30 * 60 * 1000
const listeners = new Set()
const interactions = ['pointerdown', 'pointermove', 'keydown', 'input', 'wheel', 'touchstart', 'touchmove']
const eventOptions = { capture: true, passive: true }
let lastInteraction = null
let idleMs = CLIENT_IDLE_MS

export function configureClientIdle(minutes) {
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 60) return
  idleMs = minutes * 60 * 1000
}


export const clientIsActive = () => lastInteraction === null || Date.now() - lastInteraction < idleMs

export function recordClientInteraction() {
  if (document.visibilityState === 'hidden') return
  const resumed = !clientIsActive()
  lastInteraction = Date.now()
  if (resumed) listeners.forEach(listener => listener())
}

function visible() {
  if (document.visibilityState !== 'hidden') recordClientInteraction()
}

export function subscribeClientResume(listener) {
  if (!listeners.size) {
    lastInteraction = Date.now()
    interactions.forEach(event => document.addEventListener(event, recordClientInteraction, eventOptions))
    window.addEventListener('focus', recordClientInteraction)
    document.addEventListener('visibilitychange', visible)
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (!listeners.size) {
      interactions.forEach(event => document.removeEventListener(event, recordClientInteraction, eventOptions))
      window.removeEventListener('focus', recordClientInteraction)
      document.removeEventListener('visibilitychange', visible)
      lastInteraction = null
    }
  }
}
