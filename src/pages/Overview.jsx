import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Wallet } from 'lucide-react'
import { dateInput } from '../lib/time'
import { api, money } from '../lib/api'
import { useApp } from '../App'
import ProgressBar from '../components/ProgressBar'
import EmptyState from '../components/EmptyState'
import LedgerRow, { TransactionDetails } from '../components/LedgerRow'
import { useViewState } from '../lib/viewState'
import AnimatedMoney from '../components/AnimatedMoney'

export default function Overview() {
  const { user, settings, refreshKey } = useApp()
  const [data, setData] = useState(null)
  const [month, setMonth] = useViewState(`overview:${user?.id}:month`, dateInput().slice(0, 7))
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(null)
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
      <div><p className="muted">Personal balance</p><h1>{data ? <AnimatedMoney value={data.total_balance} currency={settings.currency} compact={settings.compact_numbers}/> : '-'}</h1></div>
      <div className="overview-controls"><label className="field"><span>Month</span><input type="month" min="1000-01" max="9999-12" value={month} onChange={e => e.target.value && setMonth(e.target.value)}/></label></div>
    </section>
    {error && <div className="form-error" role="alert">{error}</div>}
    {data && <div aria-busy={data.month !== month} className={data.month !== month ? 'overview-loading' : ''}>
      <section className="overview-metrics" aria-label="Selected month summary">
        <Link to="/transactions" state={{aiFilters:{month,type:'income'}}}><span>Money in</span><strong className="tx-amount income">{fmt(data.income)}</strong>{data.opening_funds > 0 && <small>Includes starting funds</small>}</Link>
        <Link to="/transactions" state={{aiFilters:{month,type:'expense',exclude_opening:true}}}><span>Spent</span><strong className="tx-amount expense">{fmt(data.expense)}</strong></Link>
        <Link to="/transactions" state={filteredLink}><span>Net change</span><strong>{fmt(data.net)}</strong></Link>
      </section>
      {data.shared?.wallet_count > 0 && <section className="overview-shared" aria-label="Shared wallets summary"><div><span>Shared balance</span><strong>{fmt(data.shared.balance)}</strong><small>{data.shared.wallet_count} shared wallets, separate from personal</small></div><Link to="/shared-transactions">View shared <ArrowRight size={16}/></Link></section>}
      <section className="overview-wallets" aria-label="Personal wallets">
        {data.wallets?.map(w => <Link key={w.id} to="/transactions" state={{ aiFilters: { wallet: String(w.id), month } }}><span><Wallet size={16}/>{w.name}</span><strong>{fmt(w.balance)}</strong></Link>)}
        {!data.wallets?.length && <Link to="/wallets">Add a personal wallet <ArrowRight size={16}/></Link>}
      </section>
      <div className="overview-columns">
        <section className="overview-section">
          <div className="panel-head"><h3>Budget progress</h3><Link to="/budgets" className="overview-link">View all <ArrowRight size={15}/></Link></div>
          {data.budgets.length ? <div className="overview-budgets">{[...data.budgets].sort((a, b) => b.progress - a.progress).slice(0, 3).map(b => <Link className="record-link" key={b.id} to="/transactions" state={{aiFilters:{type:'expense',category:b.category_id ? String(b.category_id) : '',date_from:b.records_from,date_to:b.records_to,exclude_opening:true}}}>
            <div className="overview-pair"><strong>{b.name}</strong><span>{Math.round(b.progress)}% used</span></div>
            <ProgressBar value={b.progress} warning={b.progress >= 90}/>
            <div className="overview-pair muted"><span>{fmt(b.spent)} of {fmt(b.limit_amount)} ({b.period})</span><strong className={b.spent > b.limit_amount ? 'tx-amount expense' : ''}>{fmt(Math.abs(b.limit_amount - b.spent))} {b.spent > b.limit_amount ? 'over' : 'left'}</strong></div>
          </Link>)}</div> : <EmptyState title="No budgets yet" text="Set a spending limit in Budgets."/>}
        </section>
        <section className="overview-section">
          <div className="panel-head"><h3>Top spending</h3><Link to="/transactions" state={{aiFilters:{month,type:'expense',exclude_opening:true}}} className="overview-link">View all <ArrowRight size={15}/></Link></div>
          {data.category_spending.length ? <div className="overview-categories">{data.category_spending.slice(0, 3).map(c => <Link className="record-link" key={c.id} to="/transactions" state={{aiFilters:{month,type:'expense',category:String(c.id),exclude_opening:true}}}><div className="overview-pair"><span>{c.name}</span><strong>{fmt(c.value)}</strong></div><div className="mini-track"><i style={{ width: `${Math.min(100, c.value / (data.expense || 1) * 100)}%`, background: c.color }}/></div></Link>)}</div> : <EmptyState title="No spending this month" text="Your expenses will appear here."/>}
        </section>
      </div>
      <section className="overview-section overview-recent">
        <div className="panel-head"><h3>Recent activity</h3><Link to="/transactions" state={filteredLink} className="overview-link">View all transactions <ArrowRight size={15}/></Link></div>
        {data.recent_transactions.length ? data.recent_transactions.map(tx => <LedgerRow key={tx.id} tx={tx} fmt={fmt} showDate onOpen={() => setSelected(tx)}/>) : <EmptyState title="No transactions this month" text="Add a transaction to start recording your activity."/>}
      </section>
    </div>}
    <TransactionDetails tx={selected} fmt={fmt} onClose={() => setSelected(null)}/>
  </div>
}
