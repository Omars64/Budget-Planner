import { useEffect, useRef, useState } from 'react'
import { money } from '../lib/api'
import { effectiveMotion } from '../lib/comfort'

export default function AnimatedMoney({ value, currency, compact = false }) {
  const amount = Number(value || 0)
  const previous = useRef(amount)
  const [display, setDisplay] = useState(amount)
  useEffect(() => {
    const from = previous.current
    previous.current = amount
    if (effectiveMotion() !== 'full' || from === amount) { setDisplay(amount); return }
    let frame
    const start = window.performance.now()
    const tick = now => {
      if (effectiveMotion() !== 'full') { setDisplay(amount); return }
      const progress = Math.min(1,(now-start)/280)
      setDisplay(from + (amount-from)*(1-(1-progress)**3))
      if (progress < 1) frame = window.requestAnimationFrame(tick)
    }
    frame = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frame)
  }, [amount])
  return <span aria-label={money(amount,currency,compact)}><span aria-hidden="true">{money(display,currency,compact)}</span></span>
}
