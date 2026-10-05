import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useScrollLock } from '../lib/scrollLock'

const activeDialogs = []

export default function Modal({ open, onClose, title, subtitle, children, footer, size = 'medium', layerClass = '', preserveDraft = false, protectChanges = false, isDirty }) {
  const dirty = useRef(false)
  const [discard, setDiscard] = useState(false)
  useEffect(() => { dirty.current = false; setDiscard(false) }, [open])
  const changed = isDirty ?? dirty.current
  const requestClose = () => { if ((isDirty ?? dirty.current) && protectChanges && !preserveDraft) setDiscard(true); else onClose() }
  const titleId = useId()
  const dialog = useRef(null)
  useEffect(() => { if (discard) dialog.current?.querySelector('[role="alert"] button')?.focus() }, [discard])
  const backdrop = useRef(null)
  const close = useRef(onClose)
  close.current = requestClose
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
    {open && <motion.div ref={backdrop} className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={e => e.target === e.currentTarget && requestClose()}>
      <motion.div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={`modal glass modal-${size}${footer ? ' modal-has-footer' : ''}`} initial={{ opacity: 0, scale: .99, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: .99, y: 8 }} transition={{ duration: .2, ease: 'easeOut' }}>
        <div className="modal-head"><div><h3 id={titleId}>{title}</h3>{subtitle && <p className="muted">{subtitle}</p>}</div><button className="icon-button" aria-label="Close dialog" onClick={requestClose}><X size={18}/></button></div>
        <div className="modal-body" onChangeCapture={() => { dirty.current = true }} onClickCapture={event => {
          const button = event.target.closest('button')
          if (protectChanges && isDirty === undefined && button?.hasAttribute('aria-pressed')) dirty.current = true
          if (!discard && button?.textContent.trim() === 'Cancel' && (changed || dirty.current) && protectChanges && !preserveDraft) { event.preventDefault(); event.stopPropagation(); requestClose() }
        }}>
          <div hidden={discard}>{children}</div>
          {discard && <div role="alert"><p>Discard your unsaved changes?</p><div className="modal-actions"><button type="button" className="button ghost" onClick={() => setDiscard(false)}>Keep editing</button><button type="button" className="button danger" onClick={onClose}>Discard changes</button></div></div>}
        </div>
        {footer && !discard && <div className="modal-footer">{typeof footer === 'function' ? footer(requestClose) : footer}</div>}
      </motion.div>
    </motion.div>}
  </AnimatePresence></div>, document.body)
}
