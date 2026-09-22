import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useScrollLock } from '../lib/scrollLock'

const activeDialogs = []

export default function Modal({ open, onClose, title, subtitle, children, size = 'medium', layerClass = '' }) {
  const titleId = useId()
  const dialog = useRef(null)
  const backdrop = useRef(null)
  const close = useRef(onClose)
  close.current = onClose
  useScrollLock(open)
  useEffect(() => {
    const viewport = window.visualViewport
    if (!open || !viewport) return
    let frame
    const update = () => {
      backdrop.current?.style.setProperty('--dialog-height', `${viewport.height}px`)
      backdrop.current?.style.setProperty('--dialog-top', `${viewport.offsetTop}px`)
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        const focused = document.activeElement
        if (dialog.current?.contains(focused) && focused.matches('input,textarea,select')) focused.scrollIntoView({block:'nearest',behavior:'instant'})
      })
    }
    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => { viewport.removeEventListener('resize', update); viewport.removeEventListener('scroll', update); window.cancelAnimationFrame(frame) }
  }, [open])
  useEffect(() => {
    if (!open) return
    activeDialogs.push(dialog)
    const previous = document.activeElement
    const frame = window.requestAnimationFrame(() => dialog.current?.focus())
    const keydown = event => {
      if (document.querySelector('dialog[open]') || document.body.classList.contains('driver-active') || activeDialogs.at(-1) !== dialog) return
      if (event.key === 'Escape') { event.preventDefault(); close.current() }
      if (event.key !== 'Tab' || !dialog.current) return
      const focusable = [...dialog.current.querySelectorAll('button, input, select, textarea, a[href], summary')].filter(el => !el.disabled && el.getClientRects().length)
      const first = focusable[0], last = focusable.at(-1)
      if (!first) { event.preventDefault(); return }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', keydown)
    const back = event => {
      if (event.defaultPrevented || activeDialogs.at(-1) !== dialog || document.querySelector('dialog[open]') || document.body.classList.contains('driver-active')) return
      event.preventDefault(); close.current()
    }
    window.addEventListener('budgetly:back', back)
    return () => { activeDialogs.splice(activeDialogs.indexOf(dialog), 1); window.cancelAnimationFrame(frame); document.removeEventListener('keydown', keydown); window.removeEventListener('budgetly:back', back); if (previous?.isConnected) previous.focus({ preventScroll: true }) }
  }, [open])
  return createPortal(<div className={`budgetly-v2 modal-layer ${layerClass}`}><AnimatePresence>
    {open && <motion.div ref={backdrop} className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <motion.div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={`modal glass modal-${size}`} initial={{ opacity: 0, scale: .96, y: 24 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: .98, y: 12 }} transition={{ type: 'spring', stiffness: 330, damping: 28 }}>
        <div className="modal-head"><div><h3 id={titleId}>{title}</h3>{subtitle && <p className="muted">{subtitle}</p>}</div><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={18}/></button></div>
        <div className="modal-body">{children}</div>
      </motion.div>
    </motion.div>}
  </AnimatePresence></div>, document.body)
}
