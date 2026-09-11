import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowDownLeft, ArrowRightLeft, ArrowUpRight, Copy, Pencil, Repeat2, SlidersHorizontal, Trash2 } from 'lucide-react'
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

export default function Transactions() {
  const { user, settings, refreshKey, refresh, notify ,confirm} = useApp()
  const [filters, setFilters] = useState(defaultLedgerFilters)
  const ledger = useLedger('/api/transactions', filters, refreshKey)
  const { rows, loading } = ledger
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [wallets, setWallets] = useState([])

  useEffect(() => { api('/api/wallets').then(setWallets).catch(() => setWallets([])) }, [refreshKey])

  const fmt = v => money(v, settings.currency, settings.compact_numbers)
  const grouped = useMemo(() => rows.reduce((acc, tx) => { const key = format(displayDate(tx.date), 'yyyy-MM-dd'); (acc[key] ||= []).push(tx); return acc }, {}), [rows])
  const remove = async tx => { if (!await confirm(`Delete “${tx.description}”?`)) return; try { await api(`/api/transactions/${tx.id}`, {method:'DELETE'}); refresh(); notify('Transaction deleted') } catch (err) { notify(err.message, 'error') } }

  return <div className="stack gap-18">
    <LedgerFilters value={filters} onChange={setFilters} wallets={wallets}/>
    {ledger.error && <div className="form-error" role="alert">{ledger.error}<button className="button ghost small" onClick={ledger.retry}>Retry</button></div>}

    <div className="section-row"><StatementImport wallets={wallets}/></div>
    <section className="transaction-wallets" aria-label="Current wallet balances">
      {wallets.filter(wallet => filters.wallet ? String(wallet.id) === filters.wallet : !wallet.archived).map(wallet => <div className="transaction-wallet-balance glass" key={wallet.id}><span>{wallet.name}</span><strong>{fmt(wallet.balance)}</strong></div>)}
    </section>

    <section className="panel glass">
      <div className="panel-head"><div><p className="eyebrow">Ledger</p><h3>{rows.length}{ledger.hasMore ? '+' : ''} transaction{rows.length === 1 ? '' : 's'}</h3></div><SlidersHorizontal size={18} className="muted-icon"/></div>
      {loading ? <div className="list-skeleton"><i/><i/><i/><i/></div> : !rows.length ? <EmptyState title="No matching transactions" text="Try a different filter or add a new movement."/> : <div className="date-groups">
        {Object.entries(grouped).map(([day, txs]) => <div className="date-group" key={day}>
          <div className="date-label"><strong>{format(new Date(day+'T12:00:00'), 'EEEE')}</strong><span>{format(new Date(day+'T12:00:00'), 'dd MMM yyyy')}</span></div>
          <AnimatePresence>{txs.map(tx => <motion.div className="transaction-row roomy" key={tx.id} layout initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} exit={{opacity:0,x:20}}>
            <span className={`tx-symbol ${tx.type}`}>{tx.type === 'income' ? <ArrowDownLeft size={18}/> : tx.type === 'transfer' ? <ArrowRightLeft size={18}/> : <ArrowUpRight size={18}/>}</span>
            <div className="tx-main"><strong>{tx.description}</strong><small>{tx.category_name || (tx.type === 'transfer' ? 'Transfer' : 'Uncategorized')} {tx.recurring_frequency !== 'none' && <em><Repeat2 size={12}/> {tx.recurring_frequency}</em>}</small><div className="wallet-badges"><span>{tx.wallet_name}</span>{tx.type === 'transfer' && <><ArrowRightLeft size={14} aria-label="Transfer to"/><span>{tx.transfer_wallet_name}</span></>}</div></div>
            <div className="tx-side"><strong className={`tx-amount ${tx.type}`}>{tx.type==='income'?'+':tx.type==='expense'?'−':''}{fmt(tx.amount)}</strong><small>{format(displayDate(tx.date),'HH:mm')}</small></div>
            <div className="row-actions"><button title="Duplicate as new" aria-label="Duplicate as new" onClick={()=>{sessionStorage.setItem(`flowbudget_tx_draft_${user.id}`,JSON.stringify({...tx,id:undefined,revision:undefined,date:dateInput()}));setEditing(null);setModal(true)}}><Copy size={16}/></button><button onClick={() => {setEditing(tx);setModal(true)}} aria-label="Edit"><Pencil size={16}/></button><button className="danger" onClick={() => remove(tx)} aria-label="Delete"><Trash2 size={16}/></button></div>
          </motion.div>)}</AnimatePresence>
        </div>)}
      </div>}
      <LedgerPagination ledger={ledger}/>
    </section>
    <TransactionModal open={modal} editing={editing} onClose={() => setModal(false)} onSaved={() => {setModal(false);refresh();notify(editing?'Transaction updated':'Transaction added')}} />
  </div>
}
