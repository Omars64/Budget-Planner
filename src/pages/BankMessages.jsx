import { useEffect, useState } from 'react'
import { Download, KeyRound, Plus, Trash2 } from 'lucide-react'
import { api, jsonBody } from '../lib/api'
import { useApp } from '../App'
import Modal from '../components/Modal'

export default function BankMessages() {
  const { notify, confirm, refresh } = useApp()
  const [rows, setRows] = useState([])
  const [wallets, setWallets] = useState([])
  const [enabled, setEnabled] = useState(false)
  const [token, setToken] = useState('')
  const [paste, setPaste] = useState(false)
  const [bank, setBank] = useState('NBK')
  const [text, setText] = useState('')
  const [selected, setSelected] = useState(null)
  const [form, setForm] = useState({ amount:'', description:'', wallet_id:'', date:'' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const load = async () => setRows(await api('/api/bank-messages'))
  useEffect(() => {
    Promise.all([api('/api/bank-messages'), api('/api/wallets'), api('/api/bank-messages/key')])
      .then(([messages, accounts, key]) => { setRows(messages); setWallets(accounts.filter(w => !w.archived)); setEnabled(key.enabled) })
      .catch(e => setError(e.message)).finally(() => setLoading(false))
  }, [])
  const act = async operation => {
    if (busy) return
    setBusy(true); setError('')
    try { await operation() } catch(e) { setError(e.message) } finally { setBusy(false) }
  }
  const add = e => { e.preventDefault(); act(async () => {
    // Stable message fingerprint makes pasting the same message a retry.
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(bank + ':' + text.trim()))
    const reference = Array.from(new Uint8Array(bytes), x => x.toString(16).padStart(2,'0')).join('')
    await api('/api/bank-messages', { method:'POST', ...jsonBody({ bank, message:text.trim(), reference }) })
    await load(); setPaste(false); setText(''); notify('Message added for review')
  }) }
  const review = row => {
    const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset())
    setSelected(row); setError(''); setForm({ amount:'', description:'', wallet_id:wallets[0]?.id || '', date:now.toISOString().slice(0,16) })
  }
  const record = e => { e.preventDefault(); act(async () => {
    await api(`/api/bank-messages/${selected.id}/record`, { method:'POST', ...jsonBody({ ...form, type:'expense', amount:Number(form.amount), wallet_id:Number(form.wallet_id), date:new Date(form.date).toISOString(), notes:`Imported from ${selected.bank} message` }) })
    await load(); setSelected(null); refresh(); notify('Expense recorded')
  }) }
  return <div className="stack gap-18">
    <div className="section-row"><h3>Bank messages</h3><button className="button primary" onClick={() => { setError(''); setPaste(true) }}><Plus size={18}/>Add message</button></div>
    <p className="muted">NBK, KFH, Gulf Bank and Commercial Bank of Kuwait. Forwarded messages need review before an expense is recorded. Direct bank sync is not connected.</p>
    {error && <div className="form-error" role="alert">{error}</div>}
    <section className="panel glass"><div className="section-row"><h3>Phone forwarding</h3><span>{enabled ? 'Key active' : 'Off'}</span></div>
      <div className="button-row"><button disabled={busy} className="button ghost" onClick={async () => { if (enabled && !await confirm('Replace the forwarding key? Existing phone automations will need the new key.')) return; act(async () => { const result = await api('/api/bank-messages/key', { method:'POST' }); setToken(result.token); setEnabled(true) }) }}><KeyRound size={17}/>{enabled ? 'Replace key' : 'Create forwarding key'}</button>{enabled && <button disabled={busy} className="button ghost" onClick={async () => { if (!await confirm('Disable phone forwarding?')) return; act(async () => { await api('/api/bank-messages/key', {method:'DELETE'}); setToken(''); setEnabled(false) }) }}>Disable forwarding</button>}</div>
      {token && <label className="field"><span>Forwarding key (shown once)</span><input readOnly value={token}/></label>}
      <div className="button-row"><a className="button ghost" href="/flowbudget-bank-messages-guide.pdf" download="flowbudget-bank-messages-guide.pdf"><Download size={17}/>Download setup guide</a></div><p className="muted">Requires a phone automation. Only forward transaction alerts; exclude verification codes. A forwarding key can add messages to this account but cannot read your data.</p>
    </section>
    <section className="panel glass"><div className="section-row"><h3>Pending review ({rows.length})</h3><button className="button ghost" disabled={busy} onClick={() => act(load)}>Refresh</button></div>{loading ? <p role="status">Loading messages...</p> : rows.length === 0 ? <p className="muted">No pending messages.</p> : rows.map(row => <div className="bank-message" key={row.id}><strong>{row.bank}</strong><p>{row.message}</p><div className="button-row"><button className="button primary" onClick={() => review(row)}>Review expense</button><button className="icon-button" aria-label="Remove message" onClick={async () => { if (!await confirm('Remove this message?')) return; act(async () => { await api(`/api/bank-messages/${row.id}`, {method:'DELETE'}); await load() }) }}><Trash2 size={18}/></button></div></div>)}</section>
    <Modal open={paste} onClose={() => setPaste(false)} title="Add bank message"><form onSubmit={add} className="stack gap-16"><label className="field"><span>Bank</span><select value={bank} onChange={e => setBank(e.target.value)}>{['NBK','KFH','Gulf Bank','CBK'].map(b => <option key={b}>{b}</option>)}</select></label><label className="field"><span>Transaction message</span><textarea required maxLength={2000} rows={6} value={text} onChange={e => setText(e.target.value)}/></label>{error && <div role="alert" className="form-error">{error}</div>}<button className="button primary" disabled={busy}>{busy ? 'Adding...' : 'Add for review'}</button></form></Modal>
    <Modal open={!!selected} onClose={() => setSelected(null)} title="Review expense"><form onSubmit={record} className="stack gap-16"><p className="bank-message-text">{selected?.message}</p>{[['amount','Amount','number'],['description','Description','text'],['date','Transaction date','datetime-local']].map(([key,label,type]) => <label key={key} className="field"><span>{label}</span><input required type={type} min={type === 'number' ? '0.001' : undefined} step={type === 'number' ? '0.001' : undefined} maxLength={key === 'description' ? 160 : undefined} value={form[key]} onChange={e => setForm({...form,[key]:e.target.value})}/></label>)}<label className="field"><span>Wallet</span><select required value={form.wallet_id} onChange={e => setForm({...form,wallet_id:e.target.value})}><option value="">Choose wallet</option>{wallets.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>{error && <div className="form-error" role="alert">{error}</div>}<button disabled={busy} className="button primary">{busy ? 'Recording...' : 'Record expense'}</button></form></Modal>
  </div>
}
