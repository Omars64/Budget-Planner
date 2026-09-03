import { useEffect, useMemo, useState } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ArrowDownLeft, ArrowUpRight, Landmark, Sparkles, WalletCards } from 'lucide-react'
import { format } from 'date-fns'
import { api, money } from '../lib/api'
import { useApp } from '../App'
import MetricCard from '../components/MetricCard'
import ProgressBar from '../components/ProgressBar'
import EmptyState from '../components/EmptyState'

export default function Overview() {
  const { settings, refreshKey } = useApp()
  const [data, setData] = useState(null)
  const [month, setMonth] = useState(new Date().toISOString().slice(0,7))
  const [error, setError] = useState('')
  useEffect(() => { api(`/api/dashboard?month=${month}`).then(setData).catch(e => setError(e.message)) }, [month, refreshKey])
  const fmt = v => money(v, settings.currency, settings.compact_numbers)
  const categoryMax = useMemo(() => Math.max(...(data?.category_spending || []).map(x => x.value), 1), [data])

  if (error) return <div className="error-panel glass">{error}</div>
  if (!data) return <div className="skeleton-page"><div/><div/><div/></div>

  return <div className="stack gap-22">
    <section className="hero-strip glass">
      <div>
        <p className="eyebrow"><Sparkles size={14}/> Your money, in motion</p>
        <h1>{fmt(data.total_balance)}</h1>
        <p className="muted">Total available across active wallets</p>
      </div>
      <label className="month-picker"><span>Viewing month</span><input type="month" value={month} onChange={e => setMonth(e.target.value)} /></label>
    </section>

    <section className="metric-grid">
      <MetricCard label="Total balance" value={fmt(data.total_balance)} sub="Across your wallets" icon={WalletCards} delay={.02}/>
      <MetricCard label="Income" value={fmt(data.income)} sub="This selected month" icon={ArrowDownLeft} tone="positive" delay={.06}/>
      <MetricCard label="Expenses" value={fmt(data.expense)} sub="This selected month" icon={ArrowUpRight} tone="negative" delay={.1}/>
      <MetricCard label="Net movement" value={fmt(data.net)} sub={data.net >= 0 ? 'You kept more than you spent' : 'Spending is ahead of income'} icon={Landmark} tone={data.net >= 0 ? 'positive' : 'negative'} delay={.14}/>
    </section>

    <section className="dashboard-grid">
      <div className="panel glass span-2">
        <div className="panel-head"><div><p className="eyebrow">Cash flow</p><h3>Month rhythm</h3></div><span className="legend"><i className="income-dot"/>Income <i className="expense-dot"/>Expenses</span></div>
        <div className="chart-wrap">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.cashflow} margin={{ top: 12, right: 8, left: -20, bottom: 0 }}>
              <defs><linearGradient id="incomeFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0a4173" stopOpacity=".26"/><stop offset="1" stopColor="#0a4173" stopOpacity="0"/></linearGradient><linearGradient id="expenseFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#d55f5f" stopOpacity=".2"/><stop offset="1" stopColor="#d55f5f" stopOpacity="0"/></linearGradient></defs>
              <CartesianGrid strokeDasharray="3 6" vertical={false} stroke="rgba(10,65,115,.10)" />
              <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{fontSize: 11}} />
              <YAxis axisLine={false} tickLine={false} tick={{fontSize: 11}} />
              <Tooltip contentStyle={{borderRadius: 14, border: '1px solid rgba(10,65,115,.14)', background: 'rgba(255,255,255,.92)'}} formatter={v => fmt(v)} />
              <Area type="monotone" dataKey="income" stroke="#0a4173" strokeWidth={2.4} fill="url(#incomeFill)" />
              <Area type="monotone" dataKey="expense" stroke="#d55f5f" strokeWidth={2.1} fill="url(#expenseFill)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="panel glass">
        <div className="panel-head"><div><p className="eyebrow">Spending</p><h3>Top categories</h3></div></div>
        <div className="category-bars">
          {data.category_spending.length ? data.category_spending.slice(0,5).map(c => <div className="category-bar" key={c.name}>
            <div><span>{c.name}</span><strong>{fmt(c.value)}</strong></div>
            <div className="mini-track"><i style={{width: `${c.value/categoryMax*100}%`, background: c.color}} /></div>
          </div>) : <EmptyState title="No spending yet" text="Expenses in this month will show up here."/>}
        </div>
      </div>
    </section>

    <section className="dashboard-grid">
      <div className="panel glass span-2">
        <div className="panel-head"><div><p className="eyebrow">Latest activity</p><h3>Recent transactions</h3></div></div>
        <div className="transaction-list compact">
          {data.recent_transactions.length ? data.recent_transactions.map(tx => <div className="transaction-row" key={tx.id}>
            <span className={`tx-symbol ${tx.type}`}>{tx.type === 'income' ? <ArrowDownLeft size={18}/> : <ArrowUpRight size={18}/>}</span>
            <div className="tx-main"><strong>{tx.description}</strong><small>{tx.category_name || (tx.type === 'transfer' ? `${tx.wallet_name} → ${tx.transfer_wallet_name}` : 'Uncategorized')} · {format(new Date(tx.date), 'dd MMM, HH:mm')}</small></div>
            <strong className={`tx-amount ${tx.type}`}>{tx.type === 'income' ? '+' : tx.type === 'expense' ? '−' : ''}{fmt(tx.amount)}</strong>
          </div>) : <EmptyState/>}
        </div>
      </div>
      <div className="panel glass">
        <div className="panel-head"><div><p className="eyebrow">Limits</p><h3>Budget pulse</h3></div></div>
        <div className="stack gap-16">
          {data.budgets.length ? data.budgets.slice(0,4).map(b => <div key={b.id} className="budget-mini"><div><span>{b.name}</span><strong>{Math.round(b.progress)}%</strong></div><ProgressBar value={b.progress} warning={b.progress >= 90}/><small>{fmt(b.spent)} of {fmt(b.limit_amount)}</small></div>) : <EmptyState title="No budgets" text="Create a spending limit to see its pulse."/>}
        </div>
      </div>
    </section>
  </div>
}
