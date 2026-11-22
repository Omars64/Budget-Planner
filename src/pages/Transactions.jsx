import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Wallet } from 'lucide-react'
import { format } from 'date-fns'
import { dateInput, displayDate } from '../lib/time'
import { duplicateDraft, writeDraft } from '../lib/transactionDraft'
import { api, money, readCached } from '../lib/api'
import { useApp } from '../App'
import TransactionModal from '../components/TransactionModal'
import EmptyState from '../components/EmptyState'
import StatementImport from '../components/StatementImport'
import LedgerFilters from '../components/LedgerFilters'
import { defaultLedgerFilters } from '../lib/ledgerDefaults'
import LedgerPagination from '../components/LedgerPagination'
import useLedger from '../lib/useLedger'
import { useViewState } from '../lib/viewState'
import Modal from '../components/Modal'
import AnimatedMoney from '../components/AnimatedMoney'
import OfflinePending from '../components/OfflinePending'
import TransactionSaveState from '../components/TransactionSaveState'
import LedgerRow, { LedgerDateHeader, TransactionDetails } from '../components/LedgerRow'
import { transactionRecordedEvent } from '../lib/savedFeedback'

export default function Transactions() {
  const location = useLocation()
  const { user, settings, refreshKey, refresh, notify ,confirm, isGuest, activeSpace, spaceKey = 'personal', canManage = true, canAdd = true } = useApp()
  const [walletBalancesOpen, setWalletBalancesOpen] = useState(false)
  const [filters, setFilters] = useViewState(`${spaceKey}:${user?.id}:filters`, defaultLedgerFilters, location.state?.aiFilters ? {...defaultLedgerFilters,...location.state.aiFilters} : undefined)
  useEffect(() => { if (location.state?.aiFilters) setFilters({...defaultLedgerFilters,...location.state.aiFilters}) }, [location.key])
  const [recordsRevision, setRecordsRevision] = useState(0)
  const ledger = useLedger('/api/transactions', { ...filters, scope: 'personal' }, `${refreshKey}:${recordsRevision}`, false, `${spaceKey}:${user?.id}`)
  const { rows, loading } = ledger
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [selected, setSelected] = useState(null)
  const [saveResult, setSaveResult] = useState(null)
  useEffect(() => setSaveResult(null), [user?.id, spaceKey])
  const [wallets, setWallets] = useState([])
  const activeWallets = wallets.filter(wallet => !wallet.archived)
  const [categories, setCategories] = useState([])
  const list = useRef(null)
  const anchor = useRef(null)
  const updateRecent = useRef(ledger.showRecent)
  updateRecent.current = ledger.showRecent

  useEffect(() => {
    const recorded = ({ detail }) => {
      if (detail.spaceKey !== spaceKey) return
      if (window.scrollY > 0 && list.current) {
        const row = Array.from(list.current.querySelectorAll('[data-ledger-row]')).find(node => node.getBoundingClientRect().bottom > 0)
        if (row) anchor.current = { id: row.dataset.ledgerRow, top: row.getBoundingClientRect().top, scrollY: window.scrollY }
      }
      if (detail.created) updateRecent.current(detail.transaction)
      setRecordsRevision(count => count + 1)
    }
    window.addEventListener(transactionRecordedEvent, recorded)
    return () => window.removeEventListener(transactionRecordedEvent, recorded)
  }, [spaceKey])

  useLayoutEffect(() => {
    const current = anchor.current
    if (!current) return
    const row = list.current?.querySelector(`[data-ledger-row="${current.id}"]`)
    if (row && Math.abs(window.scrollY - current.scrollY) < 12) {
      const drift = row.getBoundingClientRect().top - current.top
      if (Math.abs(drift) > 1) window.scrollTo({ top: window.scrollY + drift, behavior: 'instant' })
      current.scrollY = window.scrollY
    }
    if (!ledger.busy) anchor.current = null
  }, [rows, ledger.busy])

  useEffect(() => {
    if (location.state?.aiDraft || location.state?.resumeSchedule) {
      setEditing(null)
      setModal(true)
    }
  }, [location.key])

  useEffect(() => {
    let active = true
    Promise.resolve(readCached('/api/wallets') ?? api('/api/wallets')).then(rows => {
      if (active) setWallets(rows.filter(w => activeSpace || !w.is_shared))
    }).catch(() => {})
    Promise.resolve(readCached('/api/categories') ?? api('/api/categories')).then(rows => {
      if (active) setCategories(rows)
    }).catch(() => {})
    return () => { active = false }
  }, [refreshKey, recordsRevision, activeSpace?.id])

  const fmt = v => money(v, settings.currency, settings.compact_numbers)
  const grouped = useMemo(() => rows.reduce((acc, tx) => { const key = format(displayDate(tx.date), 'yyyy-MM-dd'); (acc[key] ||= []).push(tx); return acc }, {}), [rows])
  const remove = async tx => { if (!await confirm(`Delete “${tx.description}”?`)) return; try {
    const result = await api(`/api/transactions/${tx.id}?undo=true`, {method:'DELETE'})
    setSelected(null); refresh()
    notify(isGuest ? 'Transaction deleted from this device' : 'Transaction moved to Trash', 'success', result?.trash_id && (!activeSpace || activeSpace.role === 'owner') ? {label:'Undo',run:async()=>{await api(`/api/trash/${result.trash_id}/restore`,{method:'POST'});refresh();notify('Transaction restored')}} : null)
  } catch (err) { notify(err.message, 'error') } }

  return <div className="everyday-page transactions-page compact-transactions stack">
    <TransactionSaveState userId={user?.id} spaceId={activeSpace?.id} result={saveResult} onResume={() => {setEditing(null);setModal(true)}}/>
    {!isGuest && <OfflinePending scope={spaceKey}/>}
    <LedgerFilters compact userId={`${user?.id}:${spaceKey}`} value={filters} onChange={setFilters} wallets={wallets} categories={categories}
      balanceAction={<button type="button" className="button ghost ledger-balance-trigger" data-tour="wallet-balances" aria-label="Current wallet balances" aria-haspopup="dialog" onClick={() => setWalletBalancesOpen(true)}><Wallet size={16} aria-hidden="true"/><span>Wallet balances</span></button>}>
      {!isGuest && !activeSpace && <StatementImport wallets={wallets} compact/>}
    </LedgerFilters>
    {ledger.error && <div className="transaction-read-error" role="alert"><strong>Transactions could not be refreshed</strong><span>{ledger.error}</span><span>{ledger.updatedAt ? 'Showing the last loaded records. New saves may not appear until refresh succeeds.' : 'No current records are available. Your entry draft stays on this device.'}</span><button type="button" className="button ghost small" onClick={ledger.retry}>Retry loading</button></div>}
    {ledger.error && ledger.updatedAt && <small className="muted">Showing records last updated at {new Date(ledger.updatedAt).toLocaleTimeString()}.</small>}


    <section ref={list} className="ledger-list" aria-label="Recorded transactions">
      {ledger.error && !ledger.updatedAt ? <EmptyState title="Saved records unavailable" text="Reconnect to load this view. Any entries waiting to sync are shown above." action={<button className="button ghost" onClick={ledger.retry}>Retry loading</button>}/> : loading && !rows.length ? <div className="list-skeleton"><i/><i/><i/><i/></div> : !rows.length ? <EmptyState title="No matching transactions" text="Try another filter or add a transaction." action={<div className="button-row"><button className="button ghost" onClick={() => setFilters({...defaultLedgerFilters})}>Clear filters</button><button className="button primary" disabled={!canAdd} onClick={() => {setEditing(null);setModal(true)}}>Add transaction</button></div>}/> : <div className="date-groups">
        {Object.entries(grouped).map(([day, txs]) => <div className="date-group" key={day}>
          <LedgerDateHeader day={day} compact/>
          {txs.map(tx => <LedgerRow key={tx.id} tx={tx} fmt={fmt} compact onOpen={() => setSelected(tx)}/> )}
        </div>)}
      </div>}
      <LedgerPagination ledger={ledger}/>
    </section>
    <Modal open={walletBalancesOpen} onClose={() => setWalletBalancesOpen(false)} title="Current wallet balances" subtitle={activeSpace?.name || 'Personal wallets'} size="small">
      <div>
        {activeWallets.length ? activeWallets.map(wallet =>
          <div className="wallet-balance-row" key={wallet.id}><span><Wallet size={15} aria-hidden="true"/>{wallet.name}</span><strong><AnimatedMoney value={wallet.balance} currency={settings.currency} compact={settings.compact_numbers}/></strong></div>
        ) : <p className="muted">No active wallets to show.</p>}
      </div>
    </Modal>
    <TransactionDetails tx={selected} fmt={fmt} shared={Boolean(activeSpace)} permission={activeSpace?.role === 'owner' ? 'edit' : activeSpace?.role || 'edit'} onClose={() => setSelected(null)} onEdit={canManage ? () => {setEditing(selected);setSelected(null);setModal(true)} : null} onDelete={canManage ? () => remove(selected) : null} onDuplicate={canAdd ? () => {writeDraft(`flowbudget_tx_draft_${user.id}${activeSpace ? `_space_${activeSpace.id}` : ''}`,duplicateDraft(selected,dateInput()));setSelected(null);setEditing(null);setModal(true)} : null}/>
    <TransactionModal open={modal} editing={editing} onClose={() => setModal(false)} onSaved={(saved, scheduled) => {setModal(false);setSaveResult({queued:Boolean(saved.queued)});if (scheduled || isGuest) refresh();notify(saved.queued ? 'Saved on this device. Will sync when connected.' : editing?'Transaction updated':'Transaction added')}} />
  </div>
}
