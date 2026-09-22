import { useEffect, useState } from 'react'
import { CheckCircle2, X } from 'lucide-react'
import { successHaptic } from '../lib/comfort'

export function celebrateMilestone(key, title, name) {
  try { if (localStorage.getItem(`budgetly:milestone:${key}`)) return; localStorage.setItem(`budgetly:milestone:${key}`, 'seen') } catch { /* Completion still deserves feedback. */ }
  window.dispatchEvent(new window.CustomEvent('budgetly:milestone', {detail:{title,name}}))
  successHaptic()
}
export default function Milestone() {
  const [value, setValue] = useState(null)
  useEffect(() => {
    let timer
    const show = event => { setValue(event.detail); window.clearTimeout(timer); timer = window.setTimeout(() => setValue(null), 7000) }
    window.addEventListener('budgetly:milestone', show)
    return () => { window.removeEventListener('budgetly:milestone', show); window.clearTimeout(timer) }
  }, [])
  return value && <div className="milestone milestone-toast" role="status"><CheckCircle2/><div><strong>{value.title}</strong><small>{value.name}</small></div><button className="icon-button" aria-label="Dismiss achievement" onClick={() => setValue(null)}><X size={18}/></button></div>
}
