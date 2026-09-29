import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowDownLeft, ArrowRightLeft, ArrowUpRight, Check, ClipboardCheck, RefreshCw } from 'lucide-react'
import { api, jsonBody, money } from '../lib/api'
import { useApp } from '../App'
import Modal from './Modal'

const inKuwait = value => new Date(value).toLocaleString(undefined, {
  timeZone: 'Asia/Kuwait', dateStyle: 'medium', timeStyle: 'short',
})

export default function WalletLedger({ wallet, shared = false, onClose }) {
  const { refreshKey } = useApp()
  const navigate = useNavigate()
  const walletId = wallet?.wallet_id || wallet?.id
  const [tab, setTab] = useState('activity')
  const [ledger, setLedger] = useState(null)
  const [checks, setChecks] = useState([])
  const [checkCursor, setCheckCursor] = useState(null)
  const [loading, setLoading] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [moreLoading, setMoreLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [observed, setObserved] = useState('')
  const [note, setNote] = useState('')

  useEffect(() => {
    if (!walletId) return
    const controller = new AbortController()
    setLoading(true)
    setError('')
    setTab('activity')
    setLedger(null)
    setChecks([])
    setCheckCursor(null)
    setObserved('')
    setNote('')
    Promise.all([
      api(`/api/ledger/wallets/${walletId}`, { signal: controller.signal }),
      api(`/api/ledger/wallets/${walletId}/checks`, { signal: controller.signal }),
    ]).then(([activity, history]) => {
      if (controller.signal.aborted) return
      setLedger(activity)
      setChecks(history.checks)
      setCheckCursor(history.next_cursor)
    }).catch(err => { if (!controller.signal.aborted) setError(err.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [walletId, refreshKey, reloadKey])

  const currency = ledger?.currency || 'KWD'
  const fmt = value => money(value, currency)
  const signed = value => `${value > 0 ? '+' : value < 0 ? '-' : ''}${fmt(Math.abs(value))}`

  const loadMore = async () => {
    const cursor = ledger?.next_cursor
    if (!cursor || moreLoading) return
    setMoreLoading(true)
    setError('')
    try {
      const params = new URLSearchParams(cursor)
      const next = await api(`/api/ledger/wallets/${walletId}?${params}`)
      setLedger(current => current ? {
        ...next,
        entries: [...current.entries, ...next.entries.filter(entry => !current.entries.some(row => row.id === entry.id))],
      } : next)
    } catch (err) { setError(err.message) }
    finally { setMoreLoading(false) }
  }

  const loadMoreChecks = async () => {
    if (!checkCursor || moreLoading) return
    setMoreLoading(true)
    setError('')
    try {
      const next = await api(`/api/ledger/wallets/${walletId}/checks?before_id=${checkCursor}`)
      setChecks(current => [...current, ...next.checks.filter(check => !current.some(row => row.id === check.id))])
      setCheckCursor(next.next_cursor)
    } catch (err) { setError(err.message) }
    finally { setMoreLoading(false) }
  }

  const submit = async event => {
    event.preventDefault()
    if (saving || observed === '') return
    setSaving(true)
    setError('')
    try {
      const check = await api(`/api/ledger/wallets/${walletId}/checks`, {
        method: 'POST', ...jsonBody({ observed_balance: observed, note: note.trim() }),
      })
      setChecks(current => [check, ...current.filter(row => row.id !== check.id)])
      setObserved('')
      setNote('')
    } catch (err) { setError(err.message) }
    finally { setSaving(false) }
  }

  const latest = checks[0]
  return <Modal open={Boolean(wallet)} onClose={onClose} title={`${wallet?.name || 'Wallet'} ledger`} size="large" layerClass="wallet-ledger-layer">
    <div className="wallet-ledger">
      {loading && !ledger ? <div className="list-skeleton"><i/><i/><i/></div> : ledger && <>
        <div className="wallet-ledger-total"><span>Recorded balance</span><strong>{fmt(ledger.balance)}</strong></div>
        <div className="wallet-ledger-tabs" role="tablist" aria-label="Ledger views">
          <button type="button" role="tab" aria-selected={tab === 'activity'} className={tab === 'activity' ? 'active' : ''} onClick={() => setTab('activity')}>Activity</button>
          <button type="button" role="tab" aria-selected={tab === 'checks'} className={tab === 'checks' ? 'active' : ''} onClick={() => setTab('checks')}>Balance checks{latest && !latest.matches ? <span className="wallet-ledger-dot" aria-label="Difference recorded"/> : null}</button>
        </div>
        {tab === 'activity' ? <div role="tabpanel" className="wallet-ledger-view">
          {!ledger.entries.length ? <p className="wallet-ledger-empty">No recorded activity for this wallet.</p> : <div className="wallet-ledger-entries">
            {ledger.entries.map(entry => <div className="wallet-ledger-entry" key={entry.id}>
              <span className={`wallet-ledger-entry-icon ${entry.change < 0 ? 'out' : 'in'}`} aria-hidden="true">{entry.type === 'transfer' ? <ArrowRightLeft size={18}/> : entry.change < 0 ? <ArrowUpRight size={18}/> : <ArrowDownLeft size={18}/>}</span>
              <div className="wallet-ledger-entry-main"><strong>{entry.description}</strong><small>{inKuwait(entry.date)}{entry.category ? ` · ${entry.category}` : ''}{entry.counterparty ? ` · ${entry.counterparty}` : ''}{entry.is_future_dated ? ' · Future date' : ''}</small></div>
              <div className="wallet-ledger-entry-money"><strong className={entry.change < 0 ? 'out' : 'in'}>{signed(entry.change)}</strong><small>After {fmt(entry.balance_after)}</small></div>
            </div>)}
          </div>}
          {ledger.next_cursor && <button type="button" className="button ghost wallet-ledger-more" disabled={moreLoading} onClick={loadMore}>{moreLoading ? 'Loading...' : 'Earlier activity'}</button>}
        </div> : <div role="tabpanel" className="wallet-ledger-view">
          {ledger.can_check && <form className="wallet-ledger-check-form" onSubmit={submit}>
            <label className="field"><span>Actual bank or cash balance ({currency})</span><input type="number" step="0.001" required value={observed} onChange={event => setObserved(event.target.value)} placeholder="0.000"/></label>
            <label className="field"><span>Note (optional)</span><input maxLength={240} value={note} onChange={event => setNote(event.target.value)} placeholder="Statement or cash count"/></label>
            <button className="button primary" disabled={saving || observed === ''}><ClipboardCheck size={17}/>{saving ? 'Saving...' : 'Save balance check'}</button>
          </form>}
          {latest && <div className={`wallet-ledger-result ${latest.matches ? 'matched' : 'different'}`} role="status">
            <div className="wallet-ledger-result-heading">{latest.matches ? <Check size={19}/> : <RefreshCw size={19}/>}<strong>{latest.matches ? 'Balance matched' : `Difference: ${signed(latest.difference)}`}</strong></div>
            <div className="wallet-ledger-result-values"><span>Recorded {fmt(latest.expected_balance)}</span><span>Actual {fmt(latest.observed_balance)}</span></div>
            {!latest.matches && <button type="button" className="button ghost small" onClick={() => { onClose(); navigate(shared ? '/shared-transactions' : '/transactions') }}>Review transactions</button>}
          </div>}
          <div className="wallet-ledger-history"><h4>Previous checks</h4>{checks.length ? checks.map(check => <div className="wallet-ledger-history-row" key={check.id}>
            <span className={check.matches ? 'matched' : 'different'} aria-hidden="true">{check.matches ? <Check size={16}/> : <RefreshCw size={16}/>}</span>
            <div><strong>{check.matches ? 'Matched' : `Difference ${signed(check.difference)}`}</strong><small>{inKuwait(check.checked_at)} · {check.checked_by}{check.note ? ` · ${check.note}` : ''}</small></div>
          </div>) : <p className="wallet-ledger-empty">No balance checks yet.</p>}</div>
          {checkCursor && <button type="button" className="button ghost wallet-ledger-more" disabled={moreLoading} onClick={loadMoreChecks}>{moreLoading ? 'Loading...' : 'Earlier checks'}</button>}
        </div>}
      </>}
      {error && <div className="form-error" role="alert">{error}<button type="button" className="button ghost small" onClick={() => setReloadKey(value => value + 1)}>Retry</button></div>}
    </div>
  </Modal>
}
