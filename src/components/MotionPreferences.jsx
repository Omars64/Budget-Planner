import { useLayoutEffect, useState } from 'react'
import { MotionConfig } from 'framer-motion'
import { comfortEvent, effectiveMotion } from '../lib/comfort'

export default function MotionPreferences({ children }) {
  const [mode, setMode] = useState(effectiveMotion)
  useLayoutEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => { const next = effectiveMotion(); document.documentElement.dataset.motion = next; setMode(next) }
    update()
    media.addEventListener('change', update)
    window.addEventListener(comfortEvent, update)
    window.addEventListener('storage', update)
    return () => { media.removeEventListener('change', update); window.removeEventListener(comfortEvent, update); window.removeEventListener('storage', update) }
  }, [])
  return <MotionConfig reducedMotion={mode === 'full' ? 'never' : 'always'} skipAnimations={mode !== 'full'}>{children}</MotionConfig>
}
