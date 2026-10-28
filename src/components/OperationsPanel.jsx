import {useCallback,useEffect,useRef,useState} from 'react'
import {RefreshCw,DatabaseBackup} from 'lucide-react'
import {api} from '../lib/api'
import {showTime} from '../lib/time'
import {useApp} from '../App'
const jobNames = {scheduler:'Scheduled entries',daily_backup:'Daily recovery',external_backup:'Independent backup'}

export default function OperationsPanel(){
  const {notify}=useApp()
  const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  const [loading,setLoading]=useState(false),[checked,setChecked]=useState(null)
  const request=useRef(null)
  const load=useCallback(async()=>{
    request.current?.abort()
    const controller=new AbortController()
    request.current=controller
    setLoading(true)
    try{
      const value=await api('/api/admin/operations',{signal:controller.signal})
      if(controller.signal.aborted)return
      setData(value);setError('');setChecked(new Date().toISOString())
    }catch(e){if(!controller.signal.aborted)setError(e.message)}
    finally{if(!controller.signal.aborted)setLoading(false)}
  },[])
  useEffect(()=>{load();return()=>request.current?.abort()},[load])
  return <section className="panel glass">
    <div className="panel-head"><h3>Service health</h3><button className="icon-button" title="Refresh service health" aria-label="Refresh service health" disabled={loading||busy} onClick={load}><RefreshCw size={18}/></button></div>
    {error&&<p className="form-error" role="alert">{error}</p>}
    {loading&&<p role="status">Checking service health…</p>}
    {checked&&<p className="muted">{error?'Last successful check: ':'Checked: '}{showTime(checked)} Kuwait{error?' · Current status is unconfirmed.':''}</p>}
    {data&&<>
      <p>Database: {data.database_engine} · Email: {data.email_configured?'Configured':'Needs configuration'}</p>
      {!data.persistent_storage&&<p className="form-error">Production storage is not persistent. Connect PostgreSQL before accepting records.</p>}
      {Object.entries(data.jobs || {}).map(([name, job])=><div className="security-item" key={name}><div><strong>{jobNames[name] || name}</strong><small>{job.last_run?showTime(job.last_run)+' Kuwait':'No heartbeat yet'}</small>{job.overdue_count>0&&<small>{job.overdue_count} overdue entries</small>}</div><span className={job.healthy===false?'form-error':'muted'}>{!job.configured?'Not configured':job.healthy?'Healthy':'Needs attention'}</span></div>)}
      <p>Daily recovery: {data.last_daily_backup?showTime(data.last_daily_backup)+' Kuwait':'Not run yet'}</p>
      <p>External backup: {data.external_backup_configured?(data.last_external_backup?showTime(data.last_external_backup)+' Kuwait':'Configured, not run yet'):'Not configured'}</p>
      <p className="muted">Daily recovery copies are stored in the same database. External backups are encrypted and stored separately when configured.</p>
      {!data.external_backup_configured&&<div className="form-error" role="status"><strong>Independent protection is not active.</strong><p>Configure private external storage before relying on recovery after a database outage.</p>{data.external_backup_missing?.length>0&&<details><summary>Missing server configuration ({data.external_backup_missing.length})</summary><ul>{data.external_backup_missing.map(name=><li key={name}><code>{name}</code></li>)}</ul><p>Save these only in the server Production environment. Never put secret values in the app or source files.</p></details>}</div>}
      <p className="muted">A successful upload confirms delivery. Verify a downloaded backup and test restoration separately; keep a protected copy of the encryption key outside the hosting account.</p>
      <button className="button ghost" disabled={busy||loading} onClick={async()=>{setBusy(true);try{const result=await api('/api/admin/operations/backup',{method:'POST'});notify(result.external_backup_configured?`Recovery completed; ${result.external_backups_created} encrypted account backups uploaded.`:'Recovery copy completed in the database. Independent backup is not configured.');await load()}catch(e){setError(e.message)}finally{setBusy(false)}}}><DatabaseBackup size={16}/>{busy?'Saving...':data.external_backup_configured?'Run recovery and backup':'Create database recovery copy'}</button>
      <details><summary>Recent errors, slow requests and backup runs</summary><div className="security-items">{data.events.map(e=><div className="security-item" key={e.id}><span>{e.area} · {e.status} · {e.duration_ms} ms</span><small>{showTime(e.created_at)}</small></div>)}</div></details>
    </>}
  </section>
}
