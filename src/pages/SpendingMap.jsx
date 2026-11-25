import { useEffect, useMemo, useRef, useState } from 'react'
import { Bus, Heart, Home, Landmark, MapPin, ShoppingBag, Utensils, Wallet, ArrowLeftRight, X } from 'lucide-react'
import { useApp } from '../App'
import { api, money } from '../lib/api'
import { dateKey, showTime } from '../lib/time'
import SettingsHelp from '../components/SettingsHelp'
import './SpendingMap.css'

const sites=[[55,54],[68,42],[36,57],[51,73],[43,27],[61,22],[28,86],[72,51],[43,44],[51,16],[32,36],[55,80],[64,62],[37,67],[56,33],[46,57]]
function pinPosition(index) {
  const [x,y]=sites[index%sites.length]
  const cluster=Math.floor(index/sites.length)
  if(!cluster)return [x,y]
  const angle=cluster*2.39996, radius=Math.min(6,1.8*Math.sqrt(cluster))
  return [x+Math.cos(angle)*radius,y+Math.sin(angle)*radius]
}
function symbol(name) {
  for(const [rule,icon] of [[/food|dining|coffee|restaurant/i,Utensils],[/shop|grocer/i,ShoppingBag],[/transport|fuel|travel/i,Bus],[/health/i,Heart],[/rent|home/i,Home],[/income|salary/i,Landmark],[/transfer/i,ArrowLeftRight]])if(rule.test(name))return icon
  return Wallet
}
export default function SpendingMap(){
  const {settings,activeSpace,refreshKey}=useApp()
  const [month,setMonth]=useState(()=>dateKey().slice(0,7)),[rows,setRows]=useState(null),[error,setError]=useState(''),[retry,setRetry]=useState(0)
  const [selected,select]=useState(''),[zoom,setZoom]=useState(1)
  const board=useRef(null), viewport=useRef(null),popup=useRef(null),drag=useRef(null)
  useEffect(()=>{const tick=()=>setMonth(dateKey().slice(0,7)),timer=setInterval(tick,60000);window.addEventListener('focus',tick);return()=>{clearInterval(timer);window.removeEventListener('focus',tick)}},[])
  useEffect(()=>{setRows(null);select('')},[month])
  useEffect(()=>{
    const controller=new AbortController(), batch=500
    async function load(){
      const [y,m]=month.split('-').map(Number),last=new Date(Date.UTC(y,m,0)).getUTCDate(), collected=new Map()
      for(let offset=0;;offset+=batch){
        const q=new URLSearchParams({scope:'personal',date_from:month+'-01T00:00:00',date_to:month+'-'+last+'T23:59:59.999999',sort:'newest',limit:batch,offset})
        const page=await api('/api/transactions?'+q,{signal:controller.signal})
        if(controller.signal.aborted)return
        for(const tx of page)collected.set(tx.id,tx)
        if(page.length<batch)break
      }
      setRows([...collected.values()]);setError('')
    }
    load().catch(e=>{if(controller.signal.aborted)return;if([401,403].includes(e.status))setRows(null);setError(e.message)})
    return()=>controller.abort()
  },[month,retry,refreshKey])
  const groups=useMemo(()=>{
    const buckets=new Map()
    for(const tx of rows||[]){const name=tx.category_name||(tx.type==='transfer'?'Wallet transfers':tx.is_opening_balance?'Opening balances':'Uncategorized')
      if(!buckets.has(name))buckets.set(name,{name,days:new Map()})
      const days=buckets.get(name).days,day=dateKey(tx.date);if(!days.has(day))days.set(day,[]);days.get(day).push(tx)}
    return [...buckets.values()].sort((a,b)=>a.name.localeCompare(b.name))
  },[rows])
  const active=groups.find(g=>g.name===selected)
  function open(name){if(groups.some(g=>g.name===name))select(name)}
  useEffect(()=>{if(!active)return;popup.current?.focus({preventScroll:true});popup.current?.scrollIntoView?.({block:'nearest',inline:'nearest'})},[active?.name])
  function close(){select('');board.current?.querySelector('[aria-expanded="true"]')?.focus({preventScroll:true})}
  return <section className="stack gap-12 spending-atlas"><div className="button-row"><strong>{activeSpace?.name||'Personal'} Â· {month}</strong><SettingsHelp title="About the spending map"><p>Each pin groups transactions by category and recording date in this workspace. Locations on the map are illustrative. Zoom in and drag to explore.</p></SettingsHelp></div>
    {error&&<p role="alert">{rows?'Showing the last loaded activity. ':''}{error} <button onClick={()=>setRetry(n=>n+1)}>Retry</button></p>}
    {!rows&&!error&&<p role="status">Loading this monthâ€™s transactionsâ€¦</p>}
    {rows&&!rows.length&&<p>No transactions this month.</p>}
    <div className="button-row"><button className="icon-button" aria-label="Zoom out" disabled={zoom===1} onClick={()=>setZoom(z=>z-.5)}>âˆ’</button><button className="button ghost small" onClick={()=>{setZoom(1);viewport.current?.scrollTo(0,0)}}>Whole map</button><button className="icon-button" aria-label="Zoom in" disabled={zoom===4} onClick={()=>setZoom(z=>z+.5)}>ï¼‹</button>
    {groups.length>0&&<label>Category <select value={active?.name||''} onChange={e=>open(e.target.value)}><option value="">Choose a pin</option>{groups.map(g=><option key={g.name}>{g.name}</option>)}</select></label>}</div>
    <div className="atlas-window" ref={viewport} tabIndex={0} aria-label="Spending map, scroll to pan when zoomed" onPointerDown={e=>{if(e.pointerType!=='mouse'||e.target.closest('button,article')||zoom===1)return;drag.current=[e.clientX,e.clientY,e.currentTarget.scrollLeft,e.currentTarget.scrollTop];e.currentTarget.setPointerCapture(e.pointerId)}} onPointerUp={()=>{drag.current=null}} onLostPointerCapture={()=>{drag.current=null}} onPointerMove={e=>{if(!drag.current)return;const [x,y,l,t]=drag.current;e.currentTarget.scrollTo(l+x-e.clientX,t+y-e.clientY)}}>
    <div ref={board} className="atlas-board" style={{width:zoom*100+'%'}}>
    {groups.map((g,i)=>{const [x,y]=pinPosition(i),Icon=symbol(g.name),opened=g===active;return <div key={g.name} className={'atlas-point'+(opened?' open':'')} style={{left:x+'%',top:y+'%'}}>
      <button className="atlas-pin" aria-expanded={opened} title={g.name} aria-label={g.name} onClick={()=>opened?close():open(g.name)}><Icon size={18}/></button>
      {opened&&<article className={'atlas-popup '+(x>55?'west ':'')+(y>55?'above':'')} ref={popup} tabIndex={-1} aria-label={g.name+' transactions'} onKeyDown={e=>{if(e.key==='Escape')close()}}>
      <header><strong>{g.name}</strong><button aria-label="Close category" onClick={close}><X size={16}/></button></header>
      {[...g.days].map(([day,items])=><section key={day}><h4>{day}</h4>{items.map(tx=><div key={tx.id}><b>{tx.description||g.name}</b><span>{tx.type} Â· {money(tx.amount,settings.currency)}</span><small>{tx.wallet_name||'Wallet'}{tx.transfer_wallet_name?' â†’ '+tx.transfer_wallet_name:''} Â· {showTime(tx.date)}</small></div>)}</section>)}</article>}
    </div>})}</div></div>
    <small><MapPin size={14}/> Select a pin to view its transactions.</small></section>
}
