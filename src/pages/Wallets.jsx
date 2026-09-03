import { useEffect, useState } from 'react'
import { Archive, Landmark, Plus, Trash2, WalletCards } from 'lucide-react'
import { api, jsonBody, money } from '../lib/api'
import { DynamicIcon } from '../lib/icons'
import { useApp } from '../App'
import Modal from '../components/Modal'
import EmptyState from '../components/EmptyState'

const fresh=()=>({name:'',type:'cash',initial_balance:0,icon:'wallet',color:'#0a4173',archived:false})
export default function Wallets(){
  const {settings,refreshKey,refresh,notify}=useApp(); const [rows,setRows]=useState([]); const [open,setOpen]=useState(false); const [editing,setEditing]=useState(null); const [form,setForm]=useState(fresh()); const [error,setError]=useState('')
  useEffect(()=>{api('/api/wallets').then(setRows)},[refreshKey]); const fmt=v=>money(v,settings.currency,settings.compact_numbers); const total=rows.filter(w=>!w.archived).reduce((a,w)=>a+w.balance,0)
  const show=(w=null)=>{setEditing(w);setForm(w?{...w}:fresh());setOpen(true);setError('')}
  const submit=async e=>{e.preventDefault();try{await api(editing?`/api/wallets/${editing.id}`:'/api/wallets',{method:editing?'PUT':'POST',...jsonBody({...form,initial_balance:Number(form.initial_balance)})});setOpen(false);refresh();notify(editing?'Wallet updated':'Wallet added')}catch(err){setError(err.message)}}
  const remove=async w=>{if(!confirm(`Delete ${w.name}?`))return;try{await api(`/api/wallets/${w.id}`,{method:'DELETE'});refresh();notify('Wallet deleted')}catch(err){notify(err.message,'error')}}
  const archive=async w=>{await api(`/api/wallets/${w.id}`,{method:'PUT',...jsonBody({...w,archived:!w.archived,initial_balance:Number(w.initial_balance)})});refresh();notify(w.archived?'Wallet restored':'Wallet archived')}
  return <div className="stack gap-22">
    <section className="wallet-hero glass"><div><p className="eyebrow">Available money</p><h1>{fmt(total)}</h1><p className="muted">Across {rows.filter(w=>!w.archived).length} active wallets</p></div><span className="wallet-orbit"><Landmark/></span></section>
    <div className="section-row"><div><p className="eyebrow">Accounts & cash</p><h3>Your wallets</h3></div><button className="button primary" onClick={()=>show()}><Plus/>Add wallet</button></div>
    <section className="wallet-grid">{rows.length?rows.map(w=><article className={`wallet-card glass ${w.archived?'archived':''}`} key={w.id} onDoubleClick={()=>show(w)}><div className="wallet-shine"/><div className="card-top"><span className="round-icon" style={{color:w.color}}><DynamicIcon name={w.icon} size={21}/></span><span className="wallet-type">{w.type}</span></div><div><p className="muted">{w.archived?'Archived':'Available balance'}</p><h2>{fmt(w.balance)}</h2><strong>{w.name}</strong></div><div className="wallet-actions"><button onClick={()=>show(w)}>Edit</button><button onClick={()=>archive(w)}><Archive size={15}/>{w.archived?'Restore':'Archive'}</button><button className="danger" onClick={()=>remove(w)}><Trash2 size={15}/>Delete</button></div></article>):<div className="panel glass full-span"><EmptyState/></div>}</section>
    <Modal open={open} onClose={()=>setOpen(false)} title={editing?'Edit wallet':'Add wallet'}><form onSubmit={submit} className="stack gap-16"><label className="field"><span>Name</span><input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Main bank"/></label><div className="form-grid two"><label className="field"><span>Type</span><select value={form.type} onChange={e=>setForm({...form,type:e.target.value})}><option value="cash">Cash</option><option value="bank">Bank</option><option value="card">Card</option><option value="digital">Digital wallet</option></select></label><label className="field"><span>{editing?'Opening balance':'Current starting balance'}</span><input type="number" step="0.001" value={form.initial_balance} onChange={e=>setForm({...form,initial_balance:e.target.value})}/></label></div>{editing&&<label className="check-row"><input type="checkbox" checked={form.archived} onChange={e=>setForm({...form,archived:e.target.checked})}/><span>Archive this wallet</span></label>}{error&&<div className="form-error">{error}</div>}<div className="modal-actions"><button type="button" className="button ghost" onClick={()=>setOpen(false)}>Cancel</button><button className="button primary">Save wallet</button></div></form></Modal>
  </div>
}
