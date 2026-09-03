import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'

export default function Modal({ open, onClose, title, subtitle, children, size = 'medium' }) {
  return <AnimatePresence>
    {open && <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <motion.div className={`modal glass modal-${size}`} initial={{ opacity: 0, scale: .96, y: 24 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: .98, y: 12 }} transition={{ type: 'spring', stiffness: 330, damping: 28 }}>
        <div className="modal-head"><div><h3>{title}</h3>{subtitle && <p className="muted">{subtitle}</p>}</div><button className="icon-button" onClick={onClose}><X size={18}/></button></div>
        <div className="modal-body">{children}</div>
      </motion.div>
    </motion.div>}
  </AnimatePresence>
}
