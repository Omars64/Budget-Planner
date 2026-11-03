import { useEffect, useState } from 'react'
import { CheckCircle2, X } from 'lucide-react'

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
