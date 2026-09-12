import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'

export default function Modal({ open, onClose, title, subtitle, children, size = 'medium' }) {
  const titleId = useId()
  const dialog = useRef(null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement
    const frame = window.requestAnimationFrame(() => dialog.current?.focus())
    const keydown = event => {
      if (document.querySelector('dialog[open]')) return
      if (event.key === 'Escape') { event.preventDefault(); close.current() }
      if (event.key !== 'Tab' || !dialog.current) return
      const focusable = [...dialog.current.querySelectorAll('button, input, select, textarea, a[href], summary')].filter(el => !el.disabled && el.getClientRects().length)
      const first = focusable[0], last = focusable.at(-1)
      if (!first) { event.preventDefault(); return }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => { window.cancelAnimationFrame(frame); document.removeEventListener('keydown', keydown); if (previous?.isConnected) previous.focus() }
  }, [open])
  return <AnimatePresence>
    {open && <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <motion.div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={`modal glass modal-${size}`} initial={{ opacity: 0, scale: .96, y: 24 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: .98, y: 12 }} transition={{ type: 'spring', stiffness: 330, damping: 28 }}>
        <div className="modal-head"><div><h3 id={titleId}>{title}</h3>{subtitle && <p className="muted">{subtitle}</p>}</div><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={18}/></button></div>
        <div className="modal-body">{children}</div>
      </motion.div>
    </motion.div>}
  </AnimatePresence>
}
