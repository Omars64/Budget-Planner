import { useEffect, useMemo, useState } from 'react'
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
import LedgerRow, { TransactionDetails } from '../components/LedgerRow'

export default function Transactions() {
  const { user, settings, refreshKey, refresh, notify ,confirm} = useApp()
  const [filters, setFilters] = useState(defaultLedgerFilters)
  const ledger = useLedger('/api/transactions', filters, refreshKey)
  const { rows, loading } = ledger
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [selected, setSelected] = useState(null)
  const [wallets, setWallets] = useState([])

  useEffect(() => { api('/api/wallets').then(setWallets).catch(() => setWallets([])) }, [refreshKey])

  const fmt = v => money(v, settings.currency, settings.compact_numbers)
  const grouped = useMemo(() => rows.reduce((acc, tx) => { const key = format(displayDate(tx.date), 'yyyy-MM-dd'); (acc[key] ||= []).push(tx); return acc }, {}), [rows])
  const remove = async tx => { if (!await confirm(`Delete “${tx.description}”?`)) return; try { await api(`/api/transactions/${tx.id}`, {method:'DELETE'}); setSelected(null); refresh(); notify('Transaction deleted') } catch (err) { notify(err.message, 'error') } }

  return <div className="ledger-page stack">
    <LedgerFilters value={filters} onChange={setFilters} wallets={wallets}><StatementImport wallets={wallets} compact/></LedgerFilters>
    {ledger.error && <div className="form-error" role="alert">{ledger.error}<button className="button ghost small" onClick={ledger.retry}>Retry</button></div>}


    <section className="transaction-wallets" aria-label="Current wallet balances">
      {wallets.filter(wallet => filters.wallet ? String(wallet.id) === filters.wallet : !wallet.archived).map(wallet => <div className="transaction-wallet-balance glass" key={wallet.id}><span><Wallet size={15}/>{wallet.name}</span><strong>{fmt(wallet.balance)}</strong></div>)}
    </section>

    <section className="ledger-list">
      <div className="ledger-count">{rows.length}{ledger.hasMore ? '+' : ''} transaction{rows.length === 1 ? '' : 's'}</div>
      {loading && !rows.length ? <div className="list-skeleton"><i/><i/><i/><i/></div> : !rows.length ? <EmptyState title="No matching transactions" text="Try a different filter or add a new movement."/> : <div className="date-groups">
        {Object.entries(grouped).map(([day, txs]) => <div className="date-group" key={day}>
          <div className="date-label"><strong>{format(new Date(day+'T12:00:00'), 'EEEE')}</strong><span>{format(new Date(day+'T12:00:00'), 'dd MMM yyyy')}</span></div>
          {txs.map(tx => <LedgerRow key={tx.id} tx={tx} fmt={fmt} onOpen={() => setSelected(tx)}/> )}
        </div>)}
      </div>}
      <LedgerPagination ledger={ledger}/>
    </section>
    <TransactionDetails tx={selected} fmt={fmt} onClose={() => setSelected(null)} onEdit={() => {setEditing(selected);setSelected(null);setModal(true)}} onDelete={() => remove(selected)} onDuplicate={() => {sessionStorage.setItem(`flowbudget_tx_draft_${user.id}`,JSON.stringify({...selected,id:undefined,revision:undefined,date:dateInput()}));setSelected(null);setEditing(null);setModal(true)}}/>
    <TransactionModal open={modal} editing={editing} onClose={() => setModal(false)} onSaved={() => {setModal(false);refresh();notify(editing?'Transaction updated':'Transaction added')}} />
  </div>
}
