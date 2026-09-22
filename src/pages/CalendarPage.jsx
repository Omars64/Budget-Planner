import { useEffect, useMemo, useState } from 'react'
import { addMonths, endOfMonth, endOfWeek, format, isSameMonth, startOfMonth, startOfWeek, subMonths, eachDayOfInterval } from 'date-fns'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {displayDate} from '../lib/time'
import { api, money } from '../lib/api'
import { useApp } from '../App'

export default function CalendarPage(){
  const {settings,refreshKey}=useApp(); const [cursor,setCursor]=useState(displayDate(new Date())); const [data,setData]=useState({}); const [selected,setSelected]=useState(null); const [txs,setTxs]=useState([]); const [error,setError]=useState(''); const [retry,setRetry]=useState(0)
  const [dayError,setDayError]=useState(''); const [dayLoading,setDayLoading]=useState(false); const [monthLoading,setMonthLoading]=useState(true)
  const weekStartsOn=settings.week_starts_on==='monday'?1:0
  useEffect(()=>{
    const controller = new window.AbortController()
    setError('')
    setData({})
    setMonthLoading(true)
    api(`/api/calendar?year=${cursor.getFullYear()}&month=${cursor.getMonth()+1}`, {signal: controller.signal}).then(value => {
      if (!controller.signal.aborted) setData(value)
    }).catch(err => {
      if (!controller.signal.aborted) setError(err.message)
    }).finally(() => {
      if (!controller.signal.aborted) setMonthLoading(false)
    })
    return () => controller.abort()
  },[cursor,refreshKey,retry])
  useEffect(()=>{
    const controller = new window.AbortController()
    setDayError('')
    if (!selected) { setTxs([]); setDayLoading(false); return () => controller.abort() }
    setTxs([])
    setDayLoading(true)
    api(`/api/transactions?scope=personal&date_from=${selected}T00:00:00&date_to=${selected}T23:59:59.999999`, {signal: controller.signal}).then(value => {
      if (!controller.signal.aborted) setTxs(value)
    }).catch(err => {
      if (!controller.signal.aborted) setDayError(err.message)
    }).finally(() => {
      if (!controller.signal.aborted) setDayLoading(false)
    })
    return () => controller.abort()
  },[selected,refreshKey,retry])
  const days=useMemo(()=>eachDayOfInterval({start:startOfWeek(startOfMonth(cursor),{weekStartsOn}),end:endOfWeek(endOfMonth(cursor),{weekStartsOn})}),[cursor,weekStartsOn])
  const labels=weekStartsOn===1?['Mon','Tue','Wed','Thu','Fri','Sat','Sun']:['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
  const fmt=v=>money(v,settings.currency,settings.compact_numbers)
  const changeMonth = value => { setSelected(null); setCursor(value) }
  return <div className="calendar-layout">
    <section className="panel glass calendar-panel" aria-busy={monthLoading}>
      <div className="calendar-head"><button className="icon-button" aria-label="Previous month" onClick={()=>changeMonth(subMonths(cursor,1))}><ChevronLeft/></button><div><p className="eyebrow">Personal financial calendar</p><h2>{format(cursor,'MMMM yyyy')}</h2></div><button className="icon-button" aria-label="Next month" onClick={()=>changeMonth(addMonths(cursor,1))}><ChevronRight/></button></div>
      {error && <div className="form-error" role="alert">{error}<button className="button ghost small" onClick={()=>setRetry(value=>value+1)}>Retry</button></div>}
      <div className="calendar-weekdays">{labels.map(d=><span key={d}>{d}</span>)}</div>
      <div className="calendar-grid">{days.map(day=>{const key=format(day,'yyyy-MM-dd'), d=data[key]; return <button key={key} aria-label={`${format(day,'EEEE, dd MMMM yyyy')}${d ? `, ${d.count} transactions` : ''}`} aria-pressed={selected===key} onClick={()=>setSelected(key)} className={`calendar-day ${!isSameMonth(day,cursor)?'outside':''} ${selected===key?'selected':''} ${d?'has-data':''}`}><span>{format(day,'d')}</span>{d&&<><div className="day-money">{d.income>0&&<small className="income">+{fmt(d.income)}</small>}{d.expense>0&&<small className="expense">−{fmt(d.expense)}</small>}</div><span className="calendar-indicators" aria-hidden="true">{d.income>0&&<i className="income"/>}{d.expense>0&&<i className="expense"/>}{!d.income&&!d.expense&&<i/>}</span></>}</button>})}</div>
    </section>
    <aside className="panel glass day-panel" aria-busy={dayLoading}><div className="panel-head"><div><p className="eyebrow">Selected day</p><h3>{selected?format(new Date(selected+'T12:00:00'),'dd MMMM yyyy'):'Choose a date'}</h3></div></div>{!selected?<p className="muted">Select a calendar day to inspect its movements.</p>:dayLoading?<p className="muted" role="status">Loading transactions...</p>:dayError?<div className="form-error" role="alert">{dayError}<button className="button ghost small" onClick={()=>setRetry(value=>value+1)}>Retry</button></div>:!txs.length?<p className="muted">No transactions recorded on this date.</p>:<div className="stack gap-10">{txs.map(t=><div className="day-tx" key={t.id}><div><strong>{t.description}</strong><small>{t.is_opening_balance?'Opening balance':t.category_name||t.type} · {format(displayDate(t.date),'HH:mm')}</small></div><strong className={t.type}>{t.type==='income'?'+':t.type==='expense'?'−':''}{fmt(t.amount)}</strong></div>)}</div>}</aside>
  </div>
}
