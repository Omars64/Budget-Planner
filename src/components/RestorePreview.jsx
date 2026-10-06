import { useRef, useState } from 'react'
import Modal from './Modal'

export default function RestorePreview({ preview, onClose, onRestore }) {
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const active = useRef(false)
  async function restore() {
    if (!confirmed || active.current) return
    active.current = true; setBusy(true); setError('')
    try { await onRestore(preview.data) }
    catch (failure) { setError(failure.message || 'Restore failed. Please try again.') }
    finally { active.current = false; setBusy(false) }
  }
  return <Modal open title="Review backup" onClose={() => { if (!active.current) onClose() }} footer={<>
    <button type="button" className="button ghost" disabled={busy} onClick={onClose}>Cancel</button>
    <button type="button" className="button danger" disabled={busy || !confirmed} onClick={restore}>{busy ? 'Restoring...' : 'Replace workspace'}</button>
  </>}>
    <div className="stack gap-12" aria-busy={busy}>
      <p style={{overflowWrap:'anywhere'}}>{preview.name}</p>
      <p>This replaces your current workspace, not merges it. Export a backup first to keep a separate copy.</p>
      <dl>{preview.counts.map(row => <div className="section-row" key={row.key}><dt>{row.label}</dt><dd>{row.count}</dd></div>)}</dl>
      <label className="check-row"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)}/>I understand my current records will be replaced.</label>
      {error && <p role="alert" className="form-error">{error}</p>}
    </div>
  </Modal>
}
