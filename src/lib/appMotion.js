import { useLayoutEffect, useState } from 'react'
import { comfortEvent, readComfort } from './comfort'

export function readAppMotion() {
  const preference = readComfort().motion
  if (preference === 'off') return 'off'
  if (preference === 'reduced' || window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return 'reduced'
  return 'full'
}

// Includes cross-tab preferences and live OS changes, including Android WebView.
export function useAppMotion() {
  const [mode, setMode] = useState(readAppMotion)
  useLayoutEffect(() => {
    const update = () => setMode(readAppMotion())
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    update()
    media?.addEventListener?.('change', update)
    window.addEventListener(comfortEvent, update)
    window.addEventListener('storage', update)
    return () => {
      media?.removeEventListener?.('change', update)
      window.removeEventListener(comfortEvent, update)
      window.removeEventListener('storage', update)
    }
  }, [])
  return mode
}

export function deliberateTransition(mode, kind = 'route') {
  return { duration: mode === 'full' ? ({ route: .32, dialog: .32, sheet: .28, popup: 1.1 }[kind] ?? .2) : 0, ease: [.22, .75, .25, 1] }
}
