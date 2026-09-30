import { CloudUpload, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { flushOfflineTransactions } from '../lib/api'
import { discardOfflineTransaction, listOfflineQueue, retryOfflineTransaction } from '../lib/offlineSync'
import { useApp } from '../App'

export default function OfflinePending({ scope }) {
  const { user, settings, confirm, notify } = useApp()
  const [rows, setRows] = useState([])
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => listOfflineQueue(user?.id).then(items => setRows(items.filter(row => scope === 'shared' ? row.path === '/api/shared/transactions' : row.path === '/api/transactions'))).catch(() => setRows([])), [user?.id, scope])
  useEffect(() => {
    void load()
    window.addEventListener('budgetly:offline-queue-changed', load)
    return () => window.removeEventListener('budgetly:offline-queue-changed', load)
  }, [load])
  const retry = async row => {
    setBusy(true)
    try { await retryOfflineTransaction(row.id, user.id); await flushOfflineTransactions(); await load() }
    catch (error) { notify(error.message, 'error') }
    finally { setBusy(false) }
  }
  const discard = async row => {
    if (!await confirm(`Discard the unsynced ${row.description || 'transaction'}? It has not reached your wallet.`)) return
    try { await discardOfflineTransaction(row.id, user.id); await load() }
    catch (error) { notify(error.message, 'error') }
  }
  if (!rows.length) return null
  return <section className="offline-pending" aria-label="Transactions waiting to sync">
    <div className="offline-pending-head"><CloudUpload size={19}/><div><strong>Saved on this device</strong><span>{rows.length} {rows.length === 1 ? 'entry' : 'entries'} waiting to sync</span></div></div>
    {rows.map(row => <div className="offline-pending-row" key={row.id}>
      <div><strong>{row.description || row.type}</strong><span>{row.type} · {settings.currency} {Number(row.amount).toFixed(settings.currency === 'KWD' ? 3 : 2)}</span>{row.status === 'failed' && <small role="alert">Needs review: {row.error}</small>}</div>
      <div className="button-row"><button type="button" className="row-icon" title="Retry sync" aria-label={`Retry ${row.description || row.type}`} disabled={busy || navigator.onLine === false} onClick={() => void retry(row)}><CloudUpload size={17}/></button><button type="button" className="row-icon danger" title="Discard local entry" aria-label={`Discard ${row.description || row.type}`} onClick={() => void discard(row)}><Trash2 size={17}/></button></div>
    </div>)}
  </section>
}
