import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Plus, Wallet } from 'lucide-react'
import { dateInput } from '../lib/time'
import { api, money } from '../lib/api'
import { useApp } from '../App'
import ProgressBar from '../components/ProgressBar'
import EmptyState from '../components/EmptyState'
import LedgerRow, { TransactionDetails } from '../components/LedgerRow'
import TransactionModal from '../components/TransactionModal'

export default function Overview() {
  const { settings, refreshKey, refresh, notify } = useApp()
  const [data, setData] = useState(null)
  const [month, setMonth] = useState(dateInput().slice(0, 7))
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(null)
  const [adding, setAdding] = useState(false)
  useEffect(() => {
    const controller = new window.AbortController()
    setError('')
    api(`/api/dashboard?month=${month}`, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setData(value) })
      .catch(e => { if (!controller.signal.aborted) setError(e.message) })
    return () => controller.abort()
  }, [month, refreshKey])
  const fmt = value => money(value, settings.currency, settings.compact_numbers)
  const filteredLink = { aiFilters: { month } }
  if (!data && !error) return <div className="skeleton-page"><div/><div/><div/></div>

  return <div className="overview-page">
    <section className="overview-balance">
      <div><p className="muted">Personal balance now</p><h1>{data ? fmt(data.total_balance) : '-'}</h1><p className="muted">Across {data?.wallets?.length || 0} active personal wallets</p></div>
      <div className="overview-controls"><label className="field"><span>Viewing month</span><input type="month" min="1000-01" max="9999-12" value={month} onChange={e => e.target.value && setMonth(e.target.value)}/></label><button className="button primary" onClick={() => setAdding(true)}><Plus size={18}/>Add transaction</button></div>
    </section>
    {error && <div className="form-error" role="alert">{error}</div>}
    {data && <div aria-busy={data.month !== month} className={data.month !== month ? 'overview-loading' : ''}>
      <section className="overview-metrics" aria-label="Selected month summary">
        <div><span>Income &amp; starting funds</span><strong className="tx-amount income">{fmt(data.income)}</strong><small>{data.opening_funds ? `Includes ${fmt(data.opening_funds)} opening balance` : 'Income recorded this month'}</small></div>
        <div><span>Spent this month</span><strong className="tx-amount expense">{fmt(data.expense)}</strong><small>Personal expenses only</small></div>
        <div><span>{data.net >= 0 ? 'Net inflow' : 'Net outflow'}</span><strong>{fmt(Math.abs(data.net))}</strong><small>{data.opening_debt ? `Includes ${fmt(data.opening_debt)} starting debt` : 'Income & starting funds less expenses'}</small></div>
      </section>
      <section className="overview-wallets" aria-label="Personal wallets">
        {data.wallets?.map(w => <Link key={w.id} to="/transactions" state={{ aiFilters: { wallet: String(w.id), month } }}><span><Wallet size={16}/>{w.name}</span><strong>{fmt(w.balance)}</strong></Link>)}
        {!data.wallets?.length && <Link to="/wallets">Add a personal wallet <ArrowRight size={16}/></Link>}
      </section>
      <div className="overview-columns">
        <section className="overview-section">
          <div className="panel-head"><h3>Budget progress</h3><Link to="/budgets" className="overview-link">View all <ArrowRight size={15}/></Link></div>
          {data.budgets.length ? <div className="overview-budgets">{[...data.budgets].sort((a, b) => b.progress - a.progress).slice(0, 3).map(b => <div key={b.id}>
            <div className="overview-pair"><strong>{b.name}</strong><span>{Math.round(b.progress)}% used</span></div>
            <ProgressBar value={b.progress} warning={b.progress >= 90}/>
            <div className="overview-pair muted"><span>{fmt(b.spent)} of {fmt(b.limit_amount)} ({b.period})</span><strong className={b.spent > b.limit_amount ? 'tx-amount expense' : ''}>{fmt(Math.abs(b.limit_amount - b.spent))} {b.spent > b.limit_amount ? 'over' : 'left'}</strong></div>
          </div>)}</div> : <EmptyState title="No budgets for this period" text="Set a personal spending limit to track your progress."/>}
        </section>
        <section className="overview-section">
          <div className="panel-head"><h3>Where your money went</h3><Link to="/transactions" state={filteredLink} className="overview-link">View all <ArrowRight size={15}/></Link></div>
          {data.category_spending.length ? <div className="overview-categories">{data.category_spending.slice(0, 3).map(c => <div key={c.name}><div className="overview-pair"><span>{c.name}</span><strong>{fmt(c.value)}</strong></div><div className="mini-track"><i style={{ width: `${Math.min(100, c.value / (data.expense || 1) * 100)}%`, background: c.color }}/></div><small>{Math.round(c.value / (data.expense || 1) * 100)}% of spending</small></div>)}</div> : <EmptyState title="No spending this month" text="Your personal expenses will appear here."/>}
        </section>
      </div>
      <section className="overview-section overview-recent">
        <div className="panel-head"><h3>Recent activity</h3><Link to="/transactions" state={filteredLink} className="overview-link">View all transactions <ArrowRight size={15}/></Link></div>
        {data.recent_transactions.length ? data.recent_transactions.map(tx => <LedgerRow key={tx.id} tx={tx} fmt={fmt} showDate onOpen={() => setSelected(tx)}/>) : <EmptyState title="No transactions this month" text="Add a transaction to start recording your activity."/>}
      </section>
    </div>}
    <TransactionDetails tx={selected} fmt={fmt} onClose={() => setSelected(null)}/>
    <TransactionModal open={adding} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); refresh(); notify('Transaction added') }}/>
  </div>
}
