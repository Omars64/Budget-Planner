import { CloudUpload, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { flushOfflineTransactions, money } from '../lib/api'
import { canDiscardOffline, discardUncertainMessage, discardOfflineTransaction, listOfflineQueue, retryOfflineTransaction } from '../lib/offlineSync'
import { useApp } from '../App'

export default function OfflinePending({ scope }) {
  const { user, settings, confirm, notify } = useApp()
  const [rows, setRows] = useState([])
  const [busy, setBusy] = useState(false)
  const identity = `${user?.id}:${scope}`
  const currentIdentity = useRef(identity)
  currentIdentity.current = identity
  const latest = useRef(0)
  const load = useCallback(() => {
    const request = ++latest.current
    return listOfflineQueue(user?.id).then(items => {
      if (currentIdentity.current !== identity || request !== latest.current) return
      setRows(items.filter(row => {
        const url = new URL(row.path, 'https://budgetly.local')
        if (scope === 'shared') return url.pathname === '/api/shared/transactions'
        const space = url.searchParams.get('space_id') || 'personal'
        return url.pathname === '/api/transactions' && (scope?.startsWith('space:') ? space === scope.slice(6) : space === 'personal')
      }))
    }).catch(() => { if (currentIdentity.current === identity && request === latest.current) setRows([]) })
  }, [user?.id, scope, identity])
  useEffect(() => {
    void load()
    window.addEventListener('budgetly:offline-queue-changed', load)
    return () => { latest.current += 1; window.removeEventListener('budgetly:offline-queue-changed', load) }
  }, [load])
  const retry = async row => {
    setBusy(true)
    try { await retryOfflineTransaction(row.id, user.id); await flushOfflineTransactions(); await load() }
    catch (error) { notify(error.message, 'error') }
    finally { setBusy(false) }
  }
  const discard = async row => {
    if (!canDiscardOffline(row)) { notify(discardUncertainMessage, 'error'); return }
    if (!await confirm(`Discard ${row.description || 'transaction'} from this device? Discard is allowed only before a save attempt starts.`)) return
    if (currentIdentity.current !== identity) return
    try { await discardOfflineTransaction(row.id, user.id); await load() }
    catch (error) { notify(error.message, 'error') }
  }
  if (!rows.length) return null
  return <section className="offline-pending" aria-label="Transactions waiting to sync">
    <div className="offline-pending-head"><CloudUpload size={19}/><div><strong>Saved on this device</strong><span>{rows.length} {rows.length === 1 ? 'entry' : 'entries'} waiting to sync</span></div></div>
    {rows.map(row => <div className="offline-pending-row" key={row.id}>
      <div><strong>{row.description || row.type}</strong><span>{row.type} · {money(row.amount,settings.currency)}</span>{!canDiscardOffline(row) && <small>{discardUncertainMessage}</small>}{row.status === 'failed' && <small role="alert">Needs review: {row.error}</small>}</div>
      <div className="button-row"><button type="button" className="row-icon" title="Retry sync" aria-label={`Retry ${row.description || row.type}`} disabled={busy || navigator.onLine === false} onClick={() => void retry(row)}><CloudUpload size={17}/></button><button type="button" className="row-icon danger" title="Discard local entry" aria-label={`Discard ${row.description || row.type}`} disabled={busy || !canDiscardOffline(row)} onClick={() => void discard(row)}><Trash2 size={17}/></button></div>
    </div>)}
  </section>
}
