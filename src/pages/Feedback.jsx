import { useEffect, useState } from 'react'
import { ArrowLeft, Inbox, MessageSquare, Plus, Search, Send } from 'lucide-react'
import { api, jsonBody } from '../lib/api'
import { useApp } from '../App'
import Modal from '../components/Modal'

export default function Feedback() {
  const { user, notify, confirm } = useApp()
  const admin = user.role === 'admin'
  const [rows, setRows] = useState([])
  const [selected, setSelected] = useState(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [compose, setCompose] = useState(false)
  const [form, setForm] = useState({ subject: '', content: '', category: 'suggestion' })
  const [reply, setReply] = useState('')
  const [status, setStatus] = useState('new')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const load = async () => { setRows(await api('/api/feedback')); setLoading(false) }
  useEffect(() => {
    let cancelled = false
    const sync = async () => {
      if (document.visibilityState === 'hidden') return
      try { const result = await api('/api/feedback'); if (!cancelled) { setRows(result); setLoading(false) } }
      catch (err) { if (!cancelled) { setError(err.message); setLoading(false) } }
    }
    sync(); const timer = setInterval(sync, 15000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [])
  const current = rows.find(r => r.id === selected)
  const visible = rows.filter(r => (filter === 'all' || r.status === filter) && `${r.subject} ${r.content} ${r.sender_name} ${r.sender_email}`.toLowerCase().includes(search.toLowerCase()))
  const open = async row => {
    if (admin && current && (reply !== current.reply || status !== current.status) && !await confirm('Discard unsaved feedback reply?')) return
    setSelected(row?.id || null); setReply(row?.reply || ''); setStatus(row?.status || 'new'); setError('')
  }
  const send = async e => {
    e.preventDefault(); setBusy(true); setError('')
    try { const result = await api('/api/feedback', { method: 'POST', ...jsonBody(form) }); await load(); setCompose(false); setForm({ subject: '', content: '', category: 'suggestion' }); setSelected(result.id); setReply(''); setStatus('new'); notify('Feedback sent') }
    catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  const update = async e => {
    e.preventDefault(); setBusy(true); setError('')
    try { await api(`/api/feedback/${current.id}`, { method: 'PUT', ...jsonBody({ status, reply }) }); await load(); notify('Feedback updated') }
    catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  return <div className={`workspace feedback-workspace ${current ? 'has-selection' : ''}`}>
    <section className="workspace-list">
      <div className="workspace-heading"><h3>{admin ? 'Feedback inbox' : 'My feedback'}</h3>{!admin && <button className="icon-button" title="Send feedback" aria-label="Send feedback" onClick={() => { setError(''); setCompose(true) }}><Plus size={20}/></button>}</div>
      <div className="workspace-search"><Search size={16}/><input aria-label="Search feedback" placeholder="Search feedback" value={search} onChange={e => setSearch(e.target.value)}/></div>
      <select className="feedback-filter" aria-label="Feedback status filter" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All feedback</option><option value="new">New</option><option value="reviewing">Reviewing</option><option value="resolved">Resolved</option></select>
      {loading ? <p className="workspace-empty">Loading feedback...</p> : !visible.length ? <div className="workspace-empty"><Inbox size={28}/><p>No feedback here yet.</p>{!admin && <button className="button primary" onClick={() => setCompose(true)}>Send feedback</button>}</div> : visible.map(r => <button key={r.id} className={`message-row ${selected === r.id ? 'selected' : ''} ${r.status === 'new' ? 'unread' : ''}`} onClick={() => open(r)}><div><strong>{admin ? r.sender_name : r.subject}</strong><small>{new Date(r.created_at).toLocaleDateString()}</small></div>{admin && <b>{r.subject}</b>}<span>{r.content.slice(0, 110)}</span><small className={`feedback-status ${r.status}`}>{r.status} · {r.category}</small></button>)}
    </section>
    <section className="workspace-reader feedback-reader">
      {error && !compose && <div role="alert" className="form-error">{error}</div>}
      {!current ? <div className="reader-empty"><MessageSquare size={32}/><h3>Select feedback to read</h3></div> : <>
        <div className="reader-toolbar"><button className="icon-button" title="Back to inbox" aria-label="Back to inbox" onClick={() => open(null)}><ArrowLeft size={18}/></button><span className={`feedback-status ${current.status}`}>{current.status}</span><small>{new Date(current.created_at).toLocaleString()}</small></div>
        <div className="feedback-body"><h2>{current.subject}</h2><div className="feedback-sender"><strong>{current.sender_name}</strong><span>{current.sender_email}</span><small>{current.category}</small></div><p className="feedback-text">{current.content}</p></div>
        {admin ? <form className="feedback-reply" onSubmit={update}><label className="field"><span>Status</span><select value={status} onChange={e => setStatus(e.target.value)}><option value="new">New</option><option value="reviewing">Reviewing</option><option value="resolved">Resolved</option></select></label><label className="field"><span>Reply to user</span><textarea rows={5} maxLength={10000} value={reply} onChange={e => setReply(e.target.value)} placeholder="Your reply appears in their Feedback section."/></label><button className="button primary" disabled={busy}><Send size={16}/>{busy ? 'Saving...' : 'Save reply & status'}</button></form> : current.reply && <div className="feedback-reply"><h3>Admin reply</h3><p className="feedback-text">{current.reply}</p></div>}
      </>}
    </section>
    <Modal open={compose} onClose={() => setCompose(false)} title="Send feedback"><form className="stack gap-16" onSubmit={send}><label className="field"><span>Category</span><select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}><option value="suggestion">Suggestion</option><option value="bug">Report a bug</option><option value="question">Question</option></select></label><label className="field"><span>Subject</span><input required maxLength={160} value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })}/></label><label className="field"><span>Details</span><textarea required rows={7} maxLength={10000} value={form.content} onChange={e => setForm({ ...form, content: e.target.value })}/></label>{error && <div className="form-error" role="alert">{error}</div>}<button className="button primary" disabled={busy || !form.subject.trim() || !form.content.trim()}><Send size={16}/>{busy ? 'Sending...' : 'Send feedback'}</button></form></Modal>
  </div>
}
