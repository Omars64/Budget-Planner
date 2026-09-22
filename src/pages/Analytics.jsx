import { useEffect, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Activity, ArrowDownLeft, ArrowUpRight } from 'lucide-react'
import { api, money } from '../lib/api'
import { useApp } from '../App'
import EmptyState from '../components/EmptyState'
import { Link, useNavigate } from 'react-router-dom'
import { effectiveMotion } from '../lib/comfort'

export default function Analytics(){
  const navigate = useNavigate()
  const records = filters => ({aiFilters:filters})
  const categoryFilters = item => ({type:'expense',category:String(item.id),exclude_opening:true})
  const openMonth = (entry,type) => { if (entry?.month_key) navigate('/transactions',{state:records({month:entry.month_key,type,exclude_opening:type==='expense'})}) }
  const animate = effectiveMotion() === 'full'
  const { settings, refreshKey } = useApp(); const [data,setData]=useState(null); const [error,setError]=useState(''); const [retry,setRetry]=useState(0)
  useEffect(()=>{
    const controller = new window.AbortController()
    setError('')
    api('/api/analytics?months=6', {signal: controller.signal}).then(value => {
      if (!controller.signal.aborted) setData(value)
    }).catch(err => {
      if (!controller.signal.aborted) setError(err.message)
    })
    return () => controller.abort()
  },[refreshKey,retry])
  const fmt=v=>money(v,settings.currency,settings.compact_numbers)
  if(!data && !error) return <div className="skeleton-page"><div/><div/></div>
  if(!data) return <section className="panel glass"><h2>Analytics unavailable</h2><p className="muted">{error}</p><button className="button ghost" onClick={()=>setRetry(value=>value+1)}>Retry</button></section>
  const income=data.trend.reduce((a,b)=>a+b.income,0), expense=data.trend.reduce((a,b)=>a+b.expense,0)
  const firstMonth = data.trend[0]?.month_key
  const lastMonth = data.trend.at(-1)?.month_key
  const lastDay = lastMonth ? new Date(Date.UTC(Number(lastMonth.slice(0,4)),Number(lastMonth.slice(5)),0)).toISOString().slice(0,10) : ''
  const range = type => records({type,date_from:firstMonth ? `${firstMonth}-01T00:00:00` : '',date_to:lastDay ? `${lastDay}T23:59:59.999999` : '',exclude_opening:type==='expense'})
  return <div className="stack gap-22">
    {error && <div className="form-error" role="alert">{error}<button className="button ghost small" onClick={()=>setRetry(value=>value+1)}>Retry</button></div>}
    <section className="insight-banner glass"><div className="insight-icon"><Activity/></div><div><p className="eyebrow">Personal six-month signal</p><h2>{income>=expense?'Income is staying ahead of spending.':'Spending has overtaken income across the period.'}</h2><p className="muted">{fmt(income)} income vs {fmt(expense)} expenses in the visible range. Shared wallets are kept out of this view.</p></div></section>
    <section className="dashboard-grid">
      <div className="panel glass span-2"><div className="panel-head"><div><p className="eyebrow">Trend</p><h3>Income vs expenses</h3></div></div><div className="chart-wrap tall"><ResponsiveContainer width="100%" height="100%"><BarChart data={data.trend} barGap={5}><CartesianGrid vertical={false} strokeDasharray="3 6" stroke="rgba(10,65,115,.10)"/><XAxis dataKey="month" axisLine={false} tickLine={false}/><YAxis axisLine={false} tickLine={false}/><Tooltip formatter={v=>fmt(v)} contentStyle={{borderRadius:8,border:'1px solid var(--line)'}}/><Bar dataKey="income" isAnimationActive={animate} onClick={entry=>openMonth(entry,'income')} cursor="pointer" fill="#0a4173" radius={[7,7,2,2]}/><Bar dataKey="expense" isAnimationActive={animate} onClick={entry=>openMonth(entry,'expense')} cursor="pointer" fill="#d97a7a" radius={[7,7,2,2]}/></BarChart></ResponsiveContainer></div><div className="chart-records" aria-label="Monthly records">{data.trend.map(item=><Link key={item.month_key} to="/transactions" state={records({month:item.month_key})}>{item.month} {item.month_key?.slice(0,4)}</Link>)}</div></div>
      <div className="panel glass"><div className="panel-head"><div><p className="eyebrow">Personal all-time mix</p><h3>Expense categories</h3></div></div>{data.categories.length?<><div className="donut-wrap"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={data.categories.slice(0,7)} isAnimationActive={animate} onClick={entry=>navigate('/transactions',{state:records(categoryFilters(entry))})} cursor="pointer" dataKey="value" nameKey="name" innerRadius={54} outerRadius={82} paddingAngle={3}>{data.categories.slice(0,7).map((c,i)=><Cell key={i} fill={c.color}/>)}</Pie><Tooltip formatter={v=>fmt(v)} /></PieChart></ResponsiveContainer><div><strong>{data.categories.length}</strong><span>active</span></div></div><div className="legend-list">{data.categories.map(c=><Link className="record-link" key={c.id} to="/transactions" state={records(categoryFilters(c))}><i style={{background:c.color}}/><span>{c.name}</span><strong>{fmt(c.value)}</strong></Link>)}</div></>:<EmptyState/>}</div>
    </section>
    <section className="metric-grid two-metrics"><Link to="/transactions" state={range('income')} className="metric-card glass record-link"><div className="metric-icon positive"><ArrowDownLeft/></div><div><p>6-month income</p><strong>{fmt(income)}</strong><small>Money added</small></div></Link><Link to="/transactions" state={range('expense')} className="metric-card glass record-link"><div className="metric-icon negative"><ArrowUpRight/></div><div><p>6-month expenses</p><strong>{fmt(expense)}</strong><small>Money spent</small></div></Link></section>
  </div>
}
