import { useEffect, useId, useState } from 'react'
import { Coffee, ExternalLink, X } from 'lucide-react'
import { dismissSupport, SUPPORT_URL, supportDismissed } from '../lib/support'

export default function SupportPrompt({ userId, guest = false, suppressed = false, popupEnabled = true }) {
  const titleId = useId()
  const [closed, setClosed] = useState(() => supportDismissed(userId))
  const [ready, setReady] = useState(false)
  const [blocked, setBlocked] = useState(true)
  const enabled = userId != null && !guest && !closed && popupEnabled
  useEffect(() => {
    if (!enabled) return
    const check = () => setBlocked(document.visibilityState === 'hidden' || Boolean(document.querySelector('[aria-modal="true"], dialog[open], .driver-popover')) || Boolean(document.activeElement?.matches('input, textarea, select, [contenteditable="true"]')))
    check()
    const observer = new window.MutationObserver(check)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-modal', 'open', 'class'] })
    document.addEventListener('visibilitychange', check)
    let frame
    const focus = () => { window.cancelAnimationFrame(frame); frame = window.requestAnimationFrame(check) }
    document.addEventListener('focusin', focus)
    document.addEventListener('focusout', focus)
    const timer = window.setTimeout(() => setReady(true), 1200)
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', check); document.removeEventListener('focusin', focus); document.removeEventListener('focusout', focus); window.cancelAnimationFrame(frame); window.clearTimeout(timer) }
  }, [enabled])
  if (!enabled || !ready || blocked || suppressed) return null
  return <section className="support-prompt" role="region" aria-labelledby={titleId}>
    <div className="support-prompt-heading"><Coffee size={23} aria-hidden="true"/><h3 id={titleId}>Enjoying Budgetly?</h3><button type="button" className="icon-button" aria-label="Close support prompt" title="Close support prompt" onClick={() => { dismissSupport(userId); setClosed(true) }}><X size={18}/></button></div>
    <p>Your support helps Budgetly keep growing. A coffee is always optional.</p>
    <a className="support-prompt-action" href={SUPPORT_URL} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Buy me a coffee<ExternalLink size={16}/></a>
  </section>
}
