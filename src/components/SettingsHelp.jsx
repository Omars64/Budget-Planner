import { useState } from 'react'
import InfoButton from './InfoButton'
import Modal from './Modal'

export default function SettingsHelp({ title, children }) {
  const [open, setOpen] = useState(false)
  return <>
    <InfoButton label={title} onClick={() => setOpen(true)}/>
    <Modal open={open} onClose={() => setOpen(false)} title={title} size="small">
      <div className="stack gap-12">{children}</div>
    </Modal>
  </>
}
