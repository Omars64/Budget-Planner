import { useEffect, useRef, useState } from 'react'
import { Download, RotateCcw, RefreshCw, Trash2 } from 'lucide-react'
import { api } from '../lib/api'
import { showTime } from '../lib/time'
import { useApp } from '../App'
import SettingsSection from './SettingsSection'

export default function TrashPanel() {
  const {refreshKey, refresh, notify, confirm} = useApp()
  const [rows, setRows] = useState([]), [copies, setCopies] = useState([])
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const locked = useRef(false)
  const load = async () => {
    try { const [items, backups] = await Promise.all([api('/api/trash'), api('/api/recovery')]); setRows(items); setCopies(backups); setError('') }
    catch (e) { setError(e.message) }
  }
  useEffect(() => { load() }, [refreshKey])
  const act = async (message, path, method, success) => {
    if (locked.current) return
    locked.current = true; setBusy(true)
    try { if (!await confirm(message)) return; await api(path, {method}); await load(); refresh(); notify(success) }
    catch (e) { setError(e.message) }
    finally { locked.current = false; setBusy(false) }
  }
  const download = async row => {
    try { const data = await api('/api/recovery/' + row.id); const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type:'application/json'})); const link = document.createElement('a'); link.href=url; link.download='budgetly-recovery-' + row.id + '.json'; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
    catch (e) { setError(e.message) }
  }
  return <SettingsSection title="Trash">
    <div className="section-row"><h4>Deleted items</h4><button className="icon-button" aria-label="Refresh Trash" title="Refresh Trash" onClick={load}><RefreshCw size={18}/></button></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {!rows.length ? <p className="muted">Trash is empty.</p> : <div className="security-items">{rows.map(r => <div className="security-item" key={r.id}><div><strong>{r.label}</strong><small>Recover by {showTime(r.recover_until)}</small></div><div className="button-row"><button className="icon-button" title="Restore item" aria-label={'Restore ' + r.label} disabled={busy} onClick={() => act('Restore ' + r.label + '? Sharing permissions are not restored automatically.', '/api/trash/' + r.id + '/restore', 'POST', 'Item restored')}><RotateCcw size={18}/></button><button className="icon-button danger" title="Delete permanently" aria-label={'Delete ' + r.label + ' permanently'} disabled={busy} onClick={() => act('Permanently delete this Trash item? This cannot be undone. Separate recovery backups are not removed.', '/api/trash/' + r.id, 'DELETE', 'Trash item deleted')}><Trash2 size={18}/></button></div></div>)}</div>}
    <h4>Recovery backups</h4>
    {!copies.length ? <p className="muted">No recovery backups.</p> : <div className="security-items">{copies.map(r => <div className="security-item" key={r.id}><div><strong>{r.reason}</strong><small>{showTime(r.created_at)}</small></div><div className="button-row"><button className="icon-button" title="Download backup" aria-label={'Download backup ' + r.id} onClick={() => download(r)}><Download size={18}/></button><button className="icon-button danger" title="Delete backup" aria-label={'Delete backup ' + r.id} disabled={busy} onClick={() => act('Permanently delete this recovery backup? Your current workspace is not affected. You will no longer be able to recover data from this copy.', '/api/recovery/' + r.id, 'DELETE', 'Recovery backup deleted')}><Trash2 size={18}/></button></div></div>)}</div>}
  </SettingsSection>
}
