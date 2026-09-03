import { useEffect, useMemo, useState } from 'react'
import { addMonths, endOfMonth, endOfWeek, format, isSameMonth, startOfMonth, startOfWeek, subMonths, eachDayOfInterval } from 'date-fns'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { api, money } from '../lib/api'
import { useApp } from '../App'

export default function CalendarPage(){
  const {settings,refreshKey}=useApp(); const [cursor,setCursor]=useState(new Date()); const [data,setData]=useState({}); const [selected,setSelected]=useState(null); const [txs,setTxs]=useState([])
  const weekStartsOn=settings.week_starts_on==='monday'?1:0
  useEffect(()=>{api(`/api/calendar?year=${cursor.getFullYear()}&month=${cursor.getMonth()+1}`).then(setData)},[cursor,refreshKey])
  useEffect(()=>{ if(selected) api(`/api/transactions?date_from=${selected}T00:00:00&date_to=${selected}T23:59:59`).then(setTxs)},[selected,refreshKey])
  const days=useMemo(()=>eachDayOfInterval({start:startOfWeek(startOfMonth(cursor),{weekStartsOn}),end:endOfWeek(endOfMonth(cursor),{weekStartsOn})}),[cursor,weekStartsOn])
  const labels=weekStartsOn===1?['Mon','Tue','Wed','Thu','Fri','Sat','Sun']:['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
  const fmt=v=>money(v,settings.currency,settings.compact_numbers)
  return <div className="calendar-layout">
    <section className="panel glass calendar-panel">
      <div className="calendar-head"><button className="icon-button" onClick={()=>setCursor(subMonths(cursor,1))}><ChevronLeft/></button><div><p className="eyebrow">Financial calendar</p><h2>{format(cursor,'MMMM yyyy')}</h2></div><button className="icon-button" onClick={()=>setCursor(addMonths(cursor,1))}><ChevronRight/></button></div>
      <div className="calendar-weekdays">{labels.map(d=><span key={d}>{d}</span>)}</div>
      <div className="calendar-grid">{days.map(day=>{const key=format(day,'yyyy-MM-dd'), d=data[key]; return <button key={key} onClick={()=>setSelected(key)} className={`calendar-day ${!isSameMonth(day,cursor)?'outside':''} ${selected===key?'selected':''} ${d?'has-data':''}`}><span>{format(day,'d')}</span>{d&&<div className="day-money">{d.income>0&&<small className="income">+{fmt(d.income)}</small>}{d.expense>0&&<small className="expense">−{fmt(d.expense)}</small>}</div>}</button>})}</div>
    </section>
    <aside className="panel glass day-panel"><div className="panel-head"><div><p className="eyebrow">Selected day</p><h3>{selected?format(new Date(selected+'T12:00:00'),'dd MMMM yyyy'):'Choose a date'}</h3></div></div>{!selected?<p className="muted">Select a calendar day to inspect its movements.</p>:!txs.length?<p className="muted">No transactions recorded on this date.</p>:<div className="stack gap-10">{txs.map(t=><div className="day-tx" key={t.id}><div><strong>{t.description}</strong><small>{t.category_name||t.type} · {format(new Date(t.date),'HH:mm')}</small></div><strong className={t.type}>{t.type==='income'?'+':t.type==='expense'?'−':''}{fmt(t.amount)}</strong></div>)}</div>}</aside>
  </div>
}
