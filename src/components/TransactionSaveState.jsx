import { useEffect, useState } from 'react'
import { CheckCircle2, CloudUpload, FilePenLine } from 'lucide-react'
import { readDraft } from '../lib/transactionDraft'
import { listOfflineQueue } from '../lib/offlineSync'

export default function TransactionSaveState({ userId, spaceId, result, onResume }) {
  const key = `flowbudget_tx_draft_${userId}${spaceId ? `_space_${spaceId}` : ''}`
  const [draft, setDraft] = useState(() => readDraft(key))
  const [queued, setQueued] = useState(false)
  useEffect(() => {
    setDraft(readDraft(key))
    const update = event => { if (event.detail?.key === key) setDraft(readDraft(key)) }
    window.addEventListener('budgetly:transaction-draft', update)
    return () => window.removeEventListener('budgetly:transaction-draft', update)
  }, [key])
  useEffect(() => {
    let active = true
    const update = () => { void listOfflineQueue(userId).then(rows => { if (active) setQueued(rows.some(row => {
      const url = new URL(row.path, 'https://budgetly.local')
      return url.pathname === '/api/transactions' && (url.searchParams.get('space_id') || 'personal') === (spaceId ? String(spaceId) : 'personal')
    })) }).catch(() => { if (active) setQueued(true) }) }
    if (result?.queued) update()
    window.addEventListener('budgetly:offline-queue-changed', update)
    return () => { active = false; window.removeEventListener('budgetly:offline-queue-changed', update) }
  }, [userId, spaceId, result?.queued])
  if (draft?.amount || draft?.description || draft?.notes) return <div className="transaction-save-state" role="status">
    <FilePenLine size={19} aria-hidden="true"/><span><strong>Entry draft kept on this device</strong><small>Continue where you left off. Nothing has been recorded yet.</small></span>
    <button type="button" className="button ghost small" onClick={onResume}>Continue</button>
  </div>
  if (!result) return null
  if (result.queued && !queued) return null
  const pending = result.queued
  return <div className="transaction-save-state" role="status">
    {pending ? <CloudUpload size={19} aria-hidden="true"/> : <CheckCircle2 size={19} aria-hidden="true"/>}
    <span><strong>{pending ? 'Saved on this device · Pending sync' : 'Saved in Budgetly'}</strong><small>{pending ? 'Your entry will sync when the connection returns. Check the pending list below.' : 'Your entry was confirmed by the server.'}</small></span>
  </div>
}
