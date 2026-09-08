import {useEffect,useState} from 'react'
import {RefreshCw,DatabaseBackup} from 'lucide-react'
import {api} from '../lib/api'
import {showTime} from '../lib/time'
import {useApp} from '../App'

export default function OperationsPanel(){
  const {notify}=useApp()
  const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  const load=()=>api('/api/admin/operations').then(setData).catch(e=>setError(e.message))
  useEffect(()=>{load()},[])
  return <section className="panel glass"><div className="panel-head"><h3>Service health</h3><button className="icon-button" title="Refresh service health" aria-label="Refresh service health" onClick={load}><RefreshCw size={18}/></button></div>{error&&<p className="form-error">{error}</p>}{data&&<><p>Database: {data.database} · Email: {data.email_configured?'Configured':'Needs configuration'}</p><p>Daily recovery: {data.last_daily_backup?showTime(data.last_daily_backup)+' Kuwait':'Not run yet'}</p><p className="muted">Daily recovery copies are stored in the same database. Independent backups also require external storage and tested restoration.</p><button className="button ghost" disabled={busy} onClick={async()=>{setBusy(true);try{await api('/api/admin/operations/backup',{method:'POST'});notify('Recovery snapshots saved');await load()}catch(e){setError(e.message)}finally{setBusy(false)}}}><DatabaseBackup size={16}/>{busy?'Saving...':'Run recovery snapshot'}</button><details><summary>Recent errors, slow requests and backup runs</summary><div className="security-items">{data.events.map(e=><div className="security-item" key={e.id}><span>{e.area} · {e.status} · {e.duration_ms} ms</span><small>{showTime(e.created_at)}</small></div>)}</div></details></>}</section>
}
