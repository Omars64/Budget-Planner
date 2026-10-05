import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, jsonBody } from '../lib/api'
import { clearGuest, guestImportSnapshot, beginGuestImport, GUEST_IMPORT_KEY } from '../lib/guest'
import { readDraft, writeDraft } from '../lib/transactionDraft'
import Modal from './Modal'

export default function GuestImport({ user, onDone }) {
  const navigate = useNavigate()
  const [initial] = useState(() => {
    try {
      const pending = JSON.parse(localStorage.getItem(GUEST_IMPORT_KEY) || 'null')
      const snapshot = pending?.snapshot || guestImportSnapshot()
      if (!['transactions', 'wallets', 'budgets'].every(key => Array.isArray(snapshot[key]))) throw new Error()
      return { snapshot, error: '' }
    } catch { return { snapshot: null, error: 'The saved guest import could not be read. Your local records have not been deleted. Export your local copy and contact support.' } }
  })
  const [snapshot, setSnapshot] = useState(initial.snapshot)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(initial.error)
  const submit = async () => {
    if (busy || !snapshot) return
    setBusy(true); setError('')
    try {
      const frozen = await beginGuestImport(user.id)
      setSnapshot(frozen)
      const result = await api('/api/guest/import', { method: 'POST', ...jsonBody(frozen) })
      const draft = readDraft('flowbudget_tx_draft_guest')
      if (draft && sessionStorage.getItem('budgetly_guest_schedule')) {
        writeDraft(`flowbudget_tx_draft_${user.id}`, { ...draft, wallet_id: result.wallet_map[draft.wallet_id] || '', transfer_wallet_id: result.wallet_map[draft.transfer_wallet_id] || '', category_id: result.category_map[draft.category_id] || '' })
        sessionStorage.setItem(`budgetly_schedule_resume_${user.id}`, 'true')
        sessionStorage.removeItem('budgetly_guest_schedule')
        navigate('/transactions', { state: { resumeSchedule: true } })
      }
      const cleared = clearGuest({ id: frozen.workspace_id, revision: frozen.revision })
      localStorage.removeItem(GUEST_IMPORT_KEY)
      onDone(`Added ${result.transactions} transactions and ${result.wallets} wallets.${cleared ? '' : ' Newer guest edits are still stored on this device.'}`)
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }
  return <Modal open onClose={() => !busy && onDone()} title="Keep your guest records?" size="small">
    {snapshot && <><p>Add {snapshot.transactions.length} transactions, {snapshot.wallets.length} wallets and {snapshot.budgets.length} budgets to <strong>{user.username}</strong> ({user.email}). Existing account records will not be replaced.</p>
    <p className="muted">Guest currency: {snapshot.currency}. No automatic currency conversion.</p></>}
    {error && <p role="alert" className="form-error">{error}</p>}
    <div className="modal-actions"><button className="button ghost" disabled={busy} onClick={() => onDone()}>Keep on device for now</button><button className="button primary" disabled={busy || !snapshot} onClick={submit}>{busy ? 'Importing...' : 'Keep my records'}</button></div>
  </Modal>
}
