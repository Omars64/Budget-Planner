import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowDownLeft, ArrowRightLeft, ArrowUpRight, Pencil, Plus, Repeat2, Search, SlidersHorizontal, Trash2 } from 'lucide-react'
import { format } from 'date-fns'
import { api, money } from '../lib/api'
import { useApp } from '../App'
import TransactionModal from '../components/TransactionModal'
import EmptyState from '../components/EmptyState'

export default function Transactions() {
  const { settings, refreshKey, refresh, notify } = useApp()
  const [rows, setRows] = useState([])
  const [search, setSearch] = useState('')
  const [type, setType] = useState('all')
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const qs = new URLSearchParams({ search, tx_type: type })
    const timer = setTimeout(() => api(`/api/transactions?${qs}`).then(setRows).finally(() => setLoading(false)), 180)
    return () => clearTimeout(timer)
  }, [search, type, refreshKey])

  const fmt = v => money(v, settings.currency, settings.compact_numbers)
  const grouped = useMemo(() => rows.reduce((acc, tx) => { const key = format(new Date(tx.date), 'yyyy-MM-dd'); (acc[key] ||= []).push(tx); return acc }, {}), [rows])
  const remove = async tx => { if (!confirm(`Delete “${tx.description}”?`)) return; await api(`/api/transactions/${tx.id}`, {method:'DELETE'}); refresh(); notify('Transaction deleted') }

  return <div className="stack gap-18">
    <section className="toolbar glass">
      <div className="search-box"><Search size={18}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search transactions or notes" /></div>
      <div className="segment-control compact-control"><button className={type==='all'?'active':''} onClick={() => setType('all')}>All</button><button className={type==='expense'?'active':''} onClick={() => setType('expense')}>Expenses</button><button className={type==='income'?'active':''} onClick={() => setType('income')}>Income</button><button className={type==='transfer'?'active':''} onClick={() => setType('transfer')}>Transfers</button></div>
      <button className="button primary desktop-only" onClick={() => {setEditing(null);setModal(true)}}><Plus size={18}/>New</button>
    </section>

    <section className="panel glass">
      <div className="panel-head"><div><p className="eyebrow">Ledger</p><h3>{rows.length} transaction{rows.length === 1 ? '' : 's'}</h3></div><SlidersHorizontal size={18} className="muted-icon"/></div>
      {loading ? <div className="list-skeleton"><i/><i/><i/><i/></div> : !rows.length ? <EmptyState title="No matching transactions" text="Try a different filter or add a new movement."/> : <div className="date-groups">
        {Object.entries(grouped).map(([day, txs]) => <div className="date-group" key={day}>
          <div className="date-label"><strong>{format(new Date(day+'T12:00:00'), 'EEEE')}</strong><span>{format(new Date(day+'T12:00:00'), 'dd MMM yyyy')}</span></div>
          <AnimatePresence>{txs.map(tx => <motion.div className="transaction-row roomy" key={tx.id} layout initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} exit={{opacity:0,x:20}}>
            <span className={`tx-symbol ${tx.type}`}>{tx.type === 'income' ? <ArrowDownLeft size={18}/> : tx.type === 'transfer' ? <ArrowRightLeft size={18}/> : <ArrowUpRight size={18}/>}</span>
            <div className="tx-main"><strong>{tx.description}</strong><small>{tx.type === 'transfer' ? `${tx.wallet_name} → ${tx.transfer_wallet_name}` : `${tx.category_name || 'Uncategorized'} · ${tx.wallet_name}`} {tx.recurring_frequency !== 'none' && <em><Repeat2 size={12}/> {tx.recurring_frequency}</em>}</small></div>
            <div className="tx-side"><strong className={`tx-amount ${tx.type}`}>{tx.type==='income'?'+':tx.type==='expense'?'−':''}{fmt(tx.amount)}</strong><small>{format(new Date(tx.date),'HH:mm')}</small></div>
            <div className="row-actions"><button onClick={() => {setEditing(tx);setModal(true)}} aria-label="Edit"><Pencil size={16}/></button><button className="danger" onClick={() => remove(tx)} aria-label="Delete"><Trash2 size={16}/></button></div>
          </motion.div>)}</AnimatePresence>
        </div>)}
      </div>}
    </section>
    <button className="floating-add mobile-only" onClick={() => {setEditing(null);setModal(true)}}><Plus size={22}/></button>
    <TransactionModal open={modal} editing={editing} onClose={() => setModal(false)} onSaved={() => {setModal(false);refresh();notify(editing?'Transaction updated':'Transaction added')}} />
  </div>
}
