import { useEffect, useRef, useState } from 'react'
import { Download, LockKeyhole, Plus, RefreshCcw, Save, ShieldCheck, Trash2, Upload } from 'lucide-react'
import { api, jsonBody } from '../lib/api'
import { useApp } from '../App'
import Modal from '../components/Modal'

export default function Settings(){
  const {user,settings,setSettings,reloadSettings,refresh,notify,lock}=useApp()
  const [form,setForm]=useState(settings)
  const [cats,setCats]=useState([])
  const [catOpen,setCatOpen]=useState(false)
  const [cat,setCat]=useState({name:'',kind:'expense',icon:'circle',color:'#0a4173'})
  const inputRef=useRef(null)
  useEffect(()=>setForm(settings),[settings])
  useEffect(()=>{api('/api/categories').then(setCats)},[])
  const save=async e=>{e.preventDefault();const updated=await api('/api/settings',{method:'PUT',...jsonBody(form)});setSettings(updated);notify('Settings saved')}
  const addCat=async e=>{e.preventDefault();await api('/api/categories',{method:'POST',...jsonBody(cat)});setCats(await api('/api/categories'));setCatOpen(false);setCat({name:'',kind:'expense',icon:'circle',color:'#0a4173'});refresh();notify('Category added')}
  const removeCat=async c=>{if(!confirm(`Delete ${c.name}?`))return;try{await api(`/api/categories/${c.id}`,{method:'DELETE'});setCats(await api('/api/categories'));refresh();notify('Category deleted')}catch(err){notify(err.message,'error')}}
  const exportBackup=async()=>{const data=await api('/api/backup');const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`flowbudget-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(url);notify('Backup exported')}
  const restore=async e=>{const file=e.target.files?.[0]; if(!file)return; try{const data=JSON.parse(await file.text());await api('/api/backup/restore',{method:'POST',body:JSON.stringify(data)});await reloadSettings();refresh();setCats(await api('/api/categories'));notify('Backup restored')}catch(err){notify(`Restore failed: ${err.message}`,'error')} finally {e.target.value=''}}
  const resetDemo=async()=>{if(!confirm('Reset your budget workspace? This replaces your current wallets and transactions.'))return;await api('/api/reset-demo',{method:'POST'});await reloadSettings();refresh();setCats(await api('/api/categories'));notify('Workspace reset')}
  return <div className="settings-grid">
    <section className="panel glass"><div className="panel-head"><div><p className="eyebrow">Preferences</p><h3>Display & locale</h3></div></div><form onSubmit={save} className="stack gap-16"><label className="field"><span>Budget name</span><input value={form.display_name||''} onChange={e=>setForm({...form,display_name:e.target.value})}/></label><div className="form-grid two"><label className="field"><span>Currency</span><input value={form.currency||'KWD'} maxLength="6" onChange={e=>setForm({...form,currency:e.target.value.toUpperCase()})}/></label><label className="field"><span>Week starts on</span><select value={form.week_starts_on||'sunday'} onChange={e=>setForm({...form,week_starts_on:e.target.value})}><option value="sunday">Sunday</option><option value="monday">Monday</option></select></label></div><label className="check-row"><input type="checkbox" checked={!!form.compact_numbers} onChange={e=>setForm({...form,compact_numbers:e.target.checked})}/><span>Use compact large numbers where possible</span></label><button className="button primary self-start"><Save/>Save preferences</button></form></section>

    <section className="panel glass"><div className="panel-head"><div><p className="eyebrow">Account</p><h3>Session</h3></div><ShieldCheck className="muted-icon"/></div><div className="security-card"><span className="security-status enabled"><LockKeyhole/>{user?.username}</span><p className="muted">{user?.email} · {user?.role === 'admin' ? 'Administrator' : 'User'} access</p><button className="button ghost self-start" onClick={lock}>Sign out</button></div></section>

    <section className="panel glass span-2-settings"><div className="panel-head"><div><p className="eyebrow">Organization</p><h3>Categories</h3></div><button className="button ghost small" onClick={()=>setCatOpen(true)}><Plus/>Add category</button></div><div className="category-settings">{cats.map(c=><div key={c.id}><span><i style={{background:c.color}}/>{c.name}<small>{c.kind}</small></span><button className="row-icon danger" onClick={()=>removeCat(c)}><Trash2/></button></div>)}</div></section>

    <section className="panel glass"><div className="panel-head"><div><p className="eyebrow">Portability</p><h3>Backup & restore</h3></div></div><p className="muted">Export a JSON snapshot of your workspace. Other users and passwords are never included.</p><div className="stack gap-10"><button className="button ghost full" onClick={exportBackup}><Download/>Export backup</button><button className="button ghost full" onClick={()=>inputRef.current?.click()}><Upload/>Restore backup</button><input ref={inputRef} hidden type="file" accept="application/json,.json" onChange={restore}/></div></section>

    <section className="panel glass"><div className="panel-head"><div><p className="eyebrow">Fresh start</p><h3>Workspace reset</h3></div></div><p className="muted">Restore a clean starter workspace for demos or visual testing.</p><button className="button ghost full" onClick={resetDemo}><RefreshCcw/>Reset workspace</button></section>

    <Modal open={catOpen} onClose={()=>setCatOpen(false)} title="Add category"><form onSubmit={addCat} className="stack gap-16"><label className="field"><span>Name</span><input required value={cat.name} onChange={e=>setCat({...cat,name:e.target.value})}/></label><div className="form-grid two"><label className="field"><span>Type</span><select value={cat.kind} onChange={e=>setCat({...cat,kind:e.target.value})}><option value="expense">Expense</option><option value="income">Income</option></select></label><label className="field"><span>Accent</span><input type="color" value={cat.color} onChange={e=>setCat({...cat,color:e.target.value})}/></label></div><div className="modal-actions"><button type="button" className="button ghost" onClick={()=>setCatOpen(false)}>Cancel</button><button className="button primary">Add category</button></div></form></Modal>
  </div>
}
