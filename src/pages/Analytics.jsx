import { useEffect, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Activity, ArrowDownLeft, ArrowUpRight } from 'lucide-react'
import { api, money } from '../lib/api'
import { useApp } from '../App'
import EmptyState from '../components/EmptyState'

export default function Analytics(){
  const { settings, refreshKey } = useApp(); const [data,setData]=useState(null)
  useEffect(()=>{api('/api/analytics?months=6').then(setData)},[refreshKey])
  const fmt=v=>money(v,settings.currency,settings.compact_numbers)
  if(!data) return <div className="skeleton-page"><div/><div/></div>
  const income=data.trend.reduce((a,b)=>a+b.income,0), expense=data.trend.reduce((a,b)=>a+b.expense,0)
  return <div className="stack gap-22">
    <section className="insight-banner glass"><div className="insight-icon"><Activity/></div><div><p className="eyebrow">Six-month signal</p><h2>{income>=expense?'Income is staying ahead of spending.':'Spending has overtaken income across the period.'}</h2><p className="muted">{fmt(income)} income vs {fmt(expense)} expenses in the visible range.</p></div></section>
    <section className="dashboard-grid">
      <div className="panel glass span-2"><div className="panel-head"><div><p className="eyebrow">Trend</p><h3>Income vs expenses</h3></div></div><div className="chart-wrap tall"><ResponsiveContainer width="100%" height="100%"><BarChart data={data.trend} barGap={5}><CartesianGrid vertical={false} strokeDasharray="3 6" stroke="rgba(10,65,115,.10)"/><XAxis dataKey="month" axisLine={false} tickLine={false}/><YAxis axisLine={false} tickLine={false}/><Tooltip formatter={v=>fmt(v)} contentStyle={{borderRadius:14,border:'1px solid rgba(10,65,115,.14)'}}/><Bar dataKey="income" fill="#0a4173" radius={[7,7,2,2]}/><Bar dataKey="expense" fill="#d97a7a" radius={[7,7,2,2]}/></BarChart></ResponsiveContainer></div></div>
      <div className="panel glass"><div className="panel-head"><div><p className="eyebrow">All-time mix</p><h3>Expense categories</h3></div></div>{data.categories.length?<><div className="donut-wrap"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={data.categories.slice(0,7)} dataKey="value" nameKey="name" innerRadius={54} outerRadius={82} paddingAngle={3}>{data.categories.slice(0,7).map((c,i)=><Cell key={i} fill={c.color}/>)}</Pie><Tooltip formatter={v=>fmt(v)} /></PieChart></ResponsiveContainer><div><strong>{data.categories.length}</strong><span>active</span></div></div><div className="legend-list">{data.categories.slice(0,5).map(c=><div key={c.name}><i style={{background:c.color}}/><span>{c.name}</span><strong>{fmt(c.value)}</strong></div>)}</div></>:<EmptyState/>}</div>
    </section>
    <section className="metric-grid two-metrics"><div className="metric-card glass"><div className="metric-icon positive"><ArrowDownLeft/></div><div><p>6-month income</p><strong>{fmt(income)}</strong><small>Money added</small></div></div><div className="metric-card glass"><div className="metric-icon negative"><ArrowUpRight/></div><div><p>6-month expenses</p><strong>{fmt(expense)}</strong><small>Money spent</small></div></div></section>
  </div>
}
