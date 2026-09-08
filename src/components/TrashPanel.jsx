import { useEffect, useState } from 'react'
import { RotateCcw, RefreshCw } from 'lucide-react'
import { api } from '../lib/api'
import { showTime } from '../lib/time'
import { useApp } from '../App'

export default function TrashPanel(){
  const {refreshKey,refresh,notify,confirm}=useApp()
  const [rows,setRows]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  const load=()=>api('/api/trash').then(r=>{setRows(r);setError('')}).catch(e=>setError(e.message))
  useEffect(()=>{load()},[refreshKey])
  const restore=async row=>{if(busy||!await confirm(`Restore ${row.label}? Sharing permissions are not restored automatically.`))return;setBusy(true);try{await api(`/api/trash/${row.id}/restore`,{method:'POST'});refresh();notify('Item restored')}catch(e){setError(e.message)}finally{setBusy(false)}}
  return <section className="panel glass span-2-settings"><div className="panel-head"><h3>Trash</h3><button className="icon-button" aria-label="Refresh Trash" title="Refresh Trash" onClick={load}><RefreshCw size={18}/></button></div><p className="muted">Deleted items can be recovered for 30 days. Restoring an item keeps your current workspace.</p>{error&&<p className="form-error" role="alert">{error}</p>}{!rows.length?<p className="muted">Trash is empty.</p>:<div className="security-items">{rows.map(r=><div className="security-item" key={r.id}><div><strong>{r.label}</strong><small>{r.kind} · Recover by {showTime(r.recover_until)} Kuwait</small></div><button className="button ghost small" disabled={busy} onClick={()=>restore(r)}><RotateCcw size={16}/>Restore</button></div>)}</div>}</section>
}
