import { useLayoutEffect } from 'react'
import { MotionConfig } from 'framer-motion'
import { useAppMotion } from '../lib/appMotion'

export default function MotionPreferences({ children }) {
  const mode = useAppMotion()
  useLayoutEffect(() => {
    document.documentElement.dataset.motion = mode
  }, [mode])
  return <MotionConfig reducedMotion={mode === 'full' ? 'never' : 'always'} skipAnimations={mode !== 'full'}>{children}</MotionConfig>
}
