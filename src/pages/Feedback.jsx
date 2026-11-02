import { showTime } from '../lib/time'
import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Inbox, MessageSquare, Plus, RefreshCw, Search, Send } from 'lucide-react'
import { api, jsonBody } from '../lib/api'
import { startReadPolling } from '../lib/resourcePolicy'
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
  const [draftRevision, setDraftRevision] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const epoch = useRef(0)
  const load = async () => { const version = epoch.current; const result = await api('/api/feedback'); if (version === epoch.current) { setRows(result); setLoading(false); setError('') } return result }
  const refreshFeedback = async () => {
    if (admin && current && (reply !== current.reply || status !== current.status) && !await confirm('Reload the saved feedback and discard your unsaved reply?')) return
    try { const result = await load(); const row = result.find(item => item.id === selected); if (admin && row) { setReply(row.reply); setStatus(row.status); setDraftRevision(row.revision) } }
    catch (err) { setError(err.message) }
  }
  useEffect(() => {
    let cancelled = false
    const sync = async () => {
      const version = epoch.current
      if (document.visibilityState === 'hidden') return
      try { const result = await api('/api/feedback'); if (!cancelled && version === epoch.current) { setRows(result); setLoading(false) } }
      catch (err) { if (!cancelled) { setError(err.message); setLoading(false) } }
    }
    const stop = startReadPolling(sync)
    return () => { cancelled = true; epoch.current += 1; stop() }
  }, [user.id])
  const current = rows.find(r => r.id === selected)
  const visible = rows.filter(r => (filter === 'all' || r.status === filter) && `${r.subject} ${r.content} ${r.sender_name} ${r.sender_email}`.toLowerCase().includes(search.toLowerCase()))
  const open = async row => {
    if (admin && current && (reply !== current.reply || status !== current.status) && !await confirm('Discard unsaved feedback reply?')) return
    setSelected(row?.id || null); setReply(row?.reply || ''); setStatus(row?.status || 'new'); setError('')
    setDraftRevision(row?.revision || null)
    if (row?.reply_unread && !admin) void markRead(row)
  }
  const markRead = async row => {
    try {
      const saved = await api(`/api/feedback/${row.id}/read`, { method: 'POST', ...jsonBody({ reply_revision: row.reply_revision }) })
      setRows(items => items.map(item => item.id === saved.id && item.reply_revision === saved.reply_revision ? { ...item, reply_unread: false } : item))
    } catch (err) { setError(err.message) }
  }
  const send = async e => {
    e.preventDefault(); setBusy(true); setError('')
    epoch.current += 1
    try { const result = await api('/api/feedback', { method: 'POST', ...jsonBody(form) }); setRows(items => [result, ...items.filter(item => item.id !== result.id)]); setCompose(false); setForm({ subject: '', content: '', category: 'suggestion' }); setSelected(result.id); setReply(''); setStatus('new'); notify('Feedback sent') }
    catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  const update = async e => {
    e.preventDefault(); setBusy(true); setError('')
    epoch.current += 1
    try { const saved = await api(`/api/feedback/${current.id}`, { method: 'PUT', ...jsonBody({ status, reply, revision: draftRevision }) }); epoch.current += 1; setRows(items => items.map(item => item.id === saved.id ? saved : item)); setReply(saved.reply); setStatus(saved.status); setDraftRevision(saved.revision); notify(reply.trim() ? 'Reply saved to the user’s Feedback section' : 'Status saved. Existing replies kept.') }
    catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  return <div className={`workspace feedback-workspace ${current ? 'has-selection' : ''}`}>
    <section className="workspace-list">
      <div className="workspace-heading"><h3>{admin ? 'Feedback inbox' : 'My feedback'}</h3><button type="button" className="icon-button" aria-label="Refresh feedback" disabled={busy} onClick={refreshFeedback}><RefreshCw size={18}/></button>{!admin && <button className="icon-button" title="Send feedback" aria-label="Send feedback" onClick={() => { setError(''); setCompose(true) }}><Plus size={20}/></button>}</div>
      <div className="workspace-search"><Search size={16}/><input aria-label="Search feedback" placeholder="Search feedback" value={search} onChange={e => setSearch(e.target.value)}/></div>
      <select className="feedback-filter" aria-label="Feedback status filter" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All feedback</option><option value="new">New</option><option value="reviewing">Reviewing</option><option value="resolved">Resolved</option></select>
      {loading ? <p className="workspace-empty">Loading feedback...</p> : !visible.length ? <div className="workspace-empty"><Inbox size={28}/><p>No feedback here yet.</p>{!admin && <button className="button primary" onClick={() => setCompose(true)}>Send feedback</button>}</div> : visible.map(r => <button key={r.id} disabled={busy} className={`message-row ${selected === r.id ? 'selected' : ''} ${r.status === 'new' ? 'unread' : ''}`} onClick={() => open(r)}><div><strong>{admin ? r.sender_name : r.subject}</strong><small>{showTime(r.created_at)}</small></div>{admin && <b>{r.subject}</b>}<span>{r.content.slice(0, 110)}</span>{!admin && r.reply_unread && <strong className="feedback-new-reply">New reply</strong>}{admin && r.reply && <small>Reply saved</small>}<small className={`feedback-status ${r.status}`}>{r.status} · {r.category}</small></button>)}
    </section>
    <section className="workspace-reader feedback-reader">
      {error && !compose && <div role="alert" className="form-error">{error}</div>}
      {!current ? <div className="reader-empty"><MessageSquare size={32}/><h3>Select feedback to read</h3></div> : <>
        <div className="reader-toolbar"><button className="icon-button" title="Back to inbox" aria-label="Back to inbox" onClick={() => open(null)}><ArrowLeft size={18}/></button><span className={`feedback-status ${current.status}`}>{current.status}</span><small>{showTime(current.created_at)}</small></div>
        <div className="feedback-body"><h2>{current.subject}</h2><div className="feedback-sender"><strong>{current.sender_name}</strong><span>{current.sender_email}</span><small>{current.category}</small></div><p className="feedback-text">{current.content}</p></div>
        {admin ? <form className="feedback-reply" onSubmit={update}><label className="field"><span>Status</span><select value={status} onChange={e => setStatus(e.target.value)}><option value="new">New</option><option value="reviewing">Reviewing</option><option value="resolved">Resolved</option></select></label><label className="field"><span>Reply to user</span><textarea rows={5} maxLength={10000} value={reply} onChange={e => setReply(e.target.value)} placeholder="Your reply appears in their Feedback section."/></label><button className="button primary" disabled={busy}><Send size={16}/>{busy ? 'Saving...' : 'Save reply & status'}</button></form> : current.reply && <div className="feedback-reply"><h3>Admin reply{current.reply_unread && <span className="feedback-new-reply"> · New</span>}</h3><p className="feedback-text">{current.reply}</p>{current.reply_unread && <button type="button" className="button ghost small" onClick={() => markRead(current)}>Mark reply as read</button>}</div>}
      </>}
    </section>
    <Modal open={compose} onClose={() => setCompose(false)} title="Send feedback"><form className="stack gap-16" onSubmit={send}><label className="field"><span>Category</span><select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}><option value="suggestion">Suggestion</option><option value="bug">Report a bug</option><option value="question">Question</option></select></label><label className="field"><span>Subject</span><input required maxLength={160} value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })}/></label><label className="field"><span>Details</span><textarea required rows={7} maxLength={10000} value={form.content} onChange={e => setForm({ ...form, content: e.target.value })}/></label>{error && <div className="form-error" role="alert">{error}</div>}<button className="button primary" disabled={busy || !form.subject.trim() || !form.content.trim()}><Send size={16}/>{busy ? 'Sending...' : 'Send feedback'}</button></form></Modal>
  </div>
}
