import { useEffect, useState } from 'react'

export default function useKeyboardViewport() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const update = () => {
      const focused = document.activeElement
      const editing = focused?.matches('input:not([type=checkbox]):not([type=radio]),textarea,[contenteditable=true]')
      const visible = Boolean(editing && window.innerHeight - viewport.height > 150)
      setOpen(visible)
    }
    update(); viewport.addEventListener('resize',update); document.addEventListener('focusin',update); document.addEventListener('focusout',update)
    return () => { viewport.removeEventListener('resize',update); document.removeEventListener('focusin',update); document.removeEventListener('focusout',update) }
  }, [])
  return open
}
