import { useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { HexColorPicker } from 'react-colorful'
import { Palette } from 'lucide-react'
import Modal from './Modal'

export default function AccentPicker({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  const id = useId()
  const valid = /^#[0-9a-f]{6}$/i.test(draft)
  return <div className="field">
    <span id={id}>Accent colour</span>
    <button type="button" className="accent-picker-trigger" aria-labelledby={id} aria-haspopup="dialog" onClick={() => { setDraft(value); setOpen(true) }}>
      <i style={{ background: value }} aria-hidden="true"/><span>{value.toUpperCase()}</span><Palette size={18}/>
    </button>
    {createPortal(<div className="budgetly-v2 accent-picker-layer">
      <Modal open={open} onClose={() => setOpen(false)} title="Accent colour">
        <form className="stack gap-16" onSubmit={event => { event.preventDefault(); event.stopPropagation(); if (valid) { onChange(draft.toLowerCase()); setOpen(false) } }}>
          <HexColorPicker color={valid ? draft : value} onChange={setDraft}/>
          <label className="field"><span>Hex colour</span><input value={draft} onChange={e => setDraft(e.target.value)} maxLength={7} autoComplete="off" spellCheck={false} aria-invalid={!valid} aria-describedby={!valid ? `${id}-error` : undefined}/></label>
          {!valid && <p id={`${id}-error`} className="form-error" role="alert">Enter # followed by six letters or numbers, for example #0a4173.</p>}
          <div className="modal-actions"><button type="button" className="button ghost" onClick={() => setOpen(false)}>Cancel</button><button className="button primary" disabled={!valid}>Apply</button></div>
        </form>
      </Modal>
    </div>, document.body)}
  </div>
}
