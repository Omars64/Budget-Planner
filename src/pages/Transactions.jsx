import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Wallet } from 'lucide-react'
import { format } from 'date-fns'
import { dateInput, displayDate } from '../lib/time'
import { api, money } from '../lib/api'
import { useApp } from '../App'
import TransactionModal from '../components/TransactionModal'
import EmptyState from '../components/EmptyState'
import StatementImport from '../components/StatementImport'
import LedgerFilters, { defaultLedgerFilters } from '../components/LedgerFilters'
import LedgerPagination from '../components/LedgerPagination'
import useLedger from '../lib/useLedger'
import { useViewState } from '../lib/viewState'
import AnimatedMoney from '../components/AnimatedMoney'
import LedgerRow, { LedgerDateHeader, TransactionDetails } from '../components/LedgerRow'

export default function Transactions() {
  const location = useLocation()
  const { user, settings, refreshKey, refresh, notify ,confirm} = useApp()
  const [filters, setFilters] = useViewState(`personal:${user?.id}:filters`, defaultLedgerFilters, location.state?.aiFilters ? {...defaultLedgerFilters,...location.state.aiFilters} : undefined)
  useEffect(() => { if (location.state?.aiFilters) setFilters({...defaultLedgerFilters,...location.state.aiFilters}) }, [location.key])
  const ledger = useLedger('/api/transactions', { ...filters, scope: 'personal' }, refreshKey, false, `personal:${user?.id}`)
  const { rows, loading } = ledger
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [selected, setSelected] = useState(null)
  const [wallets, setWallets] = useState([])
  const [categories, setCategories] = useState([])

  useEffect(() => { api('/api/wallets').then(rows => setWallets(rows.filter(w => !w.is_shared))).catch(() => setWallets([])); api('/api/categories').then(setCategories).catch(() => setCategories([])) }, [refreshKey])

  const fmt = v => money(v, settings.currency, settings.compact_numbers)
  const grouped = useMemo(() => rows.reduce((acc, tx) => { const key = format(displayDate(tx.date), 'yyyy-MM-dd'); (acc[key] ||= []).push(tx); return acc }, {}), [rows])
  const remove = async tx => { if (!await confirm(`Delete “${tx.description}”?`)) return; try {
    const result = await api(`/api/transactions/${tx.id}?undo=true`, {method:'DELETE'})
    setSelected(null); refresh()
    notify('Transaction moved to Trash', 'success', result?.trash_id ? {label:'Undo',run:async()=>{await api(`/api/trash/${result.trash_id}/restore`,{method:'POST'});refresh();notify('Transaction restored')}} : null)
  } catch (err) { notify(err.message, 'error') } }

  return <div className="ledger-page stack">
    <LedgerFilters value={filters} onChange={setFilters} wallets={wallets} categories={categories}><StatementImport wallets={wallets} compact/></LedgerFilters>
    {ledger.error && <div className="form-error" role="alert">{ledger.error}<button className="button ghost small" onClick={ledger.retry}>Retry</button></div>}
    {ledger.error && ledger.updatedAt && <small className="muted">Showing records last updated at {new Date(ledger.updatedAt).toLocaleTimeString()}.</small>}


    <section className="transaction-wallets" aria-label="Current wallet balances">
      {wallets.filter(wallet => filters.wallet ? String(wallet.id) === filters.wallet : !wallet.archived).map(wallet => <div className="transaction-wallet-balance glass" key={wallet.id}><span><Wallet size={15}/>{wallet.name}</span><strong><AnimatedMoney value={wallet.balance} currency={settings.currency} compact={settings.compact_numbers}/></strong></div>)}
    </section>

    <section className="ledger-list">
      <div className="ledger-count">{rows.length}{ledger.hasMore ? '+' : ''} transaction{rows.length === 1 ? '' : 's'}</div>
      {loading && !rows.length ? <div className="list-skeleton"><i/><i/><i/><i/></div> : !rows.length ? <EmptyState title="No matching transactions" text="Try a different filter or add a new movement."/> : <div className="date-groups">
        {Object.entries(grouped).map(([day, txs]) => <div className="date-group" key={day}>
          <LedgerDateHeader day={day}/>
          {txs.map(tx => <LedgerRow key={tx.id} tx={tx} fmt={fmt} onOpen={() => setSelected(tx)}/> )}
        </div>)}
      </div>}
      <LedgerPagination ledger={ledger}/>
    </section>
    <TransactionDetails tx={selected} fmt={fmt} onClose={() => setSelected(null)} onEdit={() => {setEditing(selected);setSelected(null);setModal(true)}} onDelete={() => remove(selected)} onDuplicate={() => {sessionStorage.setItem(`flowbudget_tx_draft_${user.id}`,JSON.stringify({...selected,id:undefined,revision:undefined,date:dateInput()}));setSelected(null);setEditing(null);setModal(true)}}/>
    <TransactionModal open={modal} editing={editing} onClose={() => setModal(false)} onSaved={() => {setModal(false);refresh();notify(editing?'Transaction updated':'Transaction added')}} />
  </div>
}
