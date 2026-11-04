import AppSelect from '../components/AppSelect'
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
  const [statusSaving, setStatusSaving] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  const replyRequest = useRef(null)
  const composer = useRef(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const epoch = useRef(0)
  const load = async () => { const version = epoch.current; const result = await api('/api/feedback'); if (version === epoch.current) { setRows(result); setLoading(false); setError('') } return result }
  const refreshFeedback = async () => {
    if (reply.trim() && !await confirm('Reload the saved feedback and discard your unsaved reply?')) return
    try { const result = await load(); const row = result.find(item => item.id === selected); if (row) { setReply(''); replyRequest.current = null } }
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
    if (reply.trim() && !await confirm('Discard unsaved feedback reply?')) return
    setSelected(row?.id || null); setReply(''); setError(''); setStatusMessage(''); replyRequest.current = null
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
    try { const result = await api('/api/feedback', { method: 'POST', ...jsonBody(form) }); setRows(items => [result, ...items.filter(item => item.id !== result.id)]); setCompose(false); setForm({ subject: '', content: '', category: 'suggestion' }); setSelected(result.id); setReply(''); notify('Feedback sent') }
    catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  const saveStatus = async value => {
    if (statusSaving || busy) return
    setStatusSaving(true); setStatusMessage('Saving…'); setError(''); epoch.current += 1
    try {
      const saved = await api(`/api/feedback/${current.id}`, { method: 'PUT', ...jsonBody({ status: value, revision: current.revision }) })
      epoch.current += 1; setRows(items => items.map(item => item.id === saved.id ? saved : item)); setStatusMessage('Saved')
    } catch (err) { setStatusMessage('Not saved'); setError(err.message) }
    finally { setStatusSaving(false) }
  }
  const postReply = async event => {
    event.preventDefault()
    if (!reply.trim() || busy || statusSaving) return
    setBusy(true); setError(''); epoch.current += 1
    replyRequest.current ??= crypto.randomUUID()
    try {
      const saved = await api(`/api/feedback/${current.id}/comments`, { method: 'POST', ...jsonBody({ content: reply.trim(), request_id: replyRequest.current }) })
      epoch.current += 1; setRows(items => items.map(item => item.id === saved.id ? saved : item))
      setReply(''); replyRequest.current = null; notify('Reply posted')
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }
  const comments = current?.comments ?? (current?.reply ? [{id:'legacy',author_name:'Budgetly',is_admin:true,content:current.reply}] : [])
  return <div className={`workspace feedback-workspace ${current ? 'has-selection' : ''}`}>
    <section className="workspace-list">
      <div className="workspace-heading"><h3>{admin ? 'Feedback inbox' : 'My feedback'}</h3><button type="button" className="icon-button" aria-label="Refresh feedback" disabled={busy || statusSaving} onClick={refreshFeedback}><RefreshCw size={18}/></button>{!admin && <button className="icon-button" title="Send feedback" aria-label="Send feedback" onClick={() => { setError(''); setCompose(true) }}><Plus size={20}/></button>}</div>
      <div className="workspace-search"><Search size={16}/><input aria-label="Search feedback" placeholder="Search feedback" value={search} onChange={e => setSearch(e.target.value)}/></div>
      <AppSelect className="feedback-filter" aria-label="Feedback status filter" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All feedback</option><option value="new">New</option><option value="reviewing">Reviewing</option><option value="resolved">Resolved</option></AppSelect>
      {loading ? <p className="workspace-empty">Loading feedback...</p> : !visible.length ? <div className="workspace-empty"><Inbox size={28}/><p>No feedback here yet.</p>{!admin && <button className="button primary" onClick={() => setCompose(true)}>Send feedback</button>}</div> : visible.map(r => <button key={r.id} disabled={busy || statusSaving} className={`message-row ${selected === r.id ? 'selected' : ''} ${r.status === 'new' ? 'unread' : ''}`} onClick={() => open(r)}><div><strong>{admin ? r.sender_name : r.subject}</strong><small>{showTime(r.created_at)}</small></div>{admin && <b>{r.subject}</b>}<span>{r.content.slice(0, 110)}</span>{!admin && r.reply_unread && <strong className="feedback-new-reply">New reply</strong>}{(r.comments?.length || r.reply) && <small>{r.comments?.length || 1} {(r.comments?.length || 1) === 1 ? 'reply' : 'replies'}</small>}<small className={`feedback-status ${r.status}`}>{r.status} · {r.category}</small></button>)}
    </section>
    <section className="workspace-reader feedback-reader">
      {error && !compose && <div role="alert" className="form-error">{error}</div>}
      {!current ? <div className="reader-empty"><MessageSquare size={32}/><h3>Select feedback to read</h3></div> : <>
        <div className="reader-toolbar"><button className="icon-button" title="Back to inbox" aria-label="Back to inbox" onClick={() => open(null)}><ArrowLeft size={18}/></button><span className={`feedback-status ${current.status}`}>{current.status}</span><small>{showTime(current.created_at)}</small></div>
        <div className="feedback-body"><h2>{current.subject}</h2><div className="feedback-sender"><strong>{current.sender_name}</strong><span>{current.sender_email}</span><small>{current.category}</small></div><p className="feedback-text">{current.content}</p></div>
        {admin && <div className="feedback-thread-status"><label htmlFor="feedback-status">Status</label><AppSelect id="feedback-status" value={current.status} disabled={statusSaving || busy} onChange={event => saveStatus(event.target.value)}><option value="new">New</option><option value="reviewing">Reviewing</option><option value="resolved">Resolved</option></AppSelect><small role="status">{statusMessage || 'Changes save automatically'}</small></div>}
        <section className="feedback-conversation" aria-label="Conversation">
          <p className="feedback-conversation-title">Private conversation · Only the sender and Budgetly administrators</p>
          {comments.map(comment => <article className="feedback-comment" key={comment.id}>
            <span className="feedback-comment-avatar" aria-hidden="true">{(comment.author_name || 'B').slice(0,1)}</span>
            <div className="feedback-comment-content"><div className="feedback-comment-head"><strong>{comment.author_name}</strong>{comment.is_admin && <span className="feedback-comment-role">Budgetly</span>}{comment.created_at && <small>{showTime(comment.created_at)}</small>}</div><p className="feedback-text">{comment.content}</p><button type="button" className="feedback-reply-link" onClick={() => composer.current?.focus()}>Reply</button></div>
          </article>)}
          {!comments.length && <p className="muted">No replies yet. Continue the conversation below.</p>}
        </section>
        <form className="feedback-reply feedback-thread-composer" onSubmit={postReply}><label className="field"><span>{admin ? 'Reply to user' : 'Your reply'}</span><textarea ref={composer} rows={3} maxLength={10000} value={reply} onChange={event => { setReply(event.target.value); replyRequest.current = null }} placeholder="Write a reply…" disabled={busy}/></label><button className="button primary" disabled={busy || statusSaving || !reply.trim()}><Send size={16}/>{busy ? 'Posting…' : 'Post reply'}</button></form>
      </>}
    </section>
    <Modal open={compose} onClose={() => setCompose(false)} title="Send feedback"><form className="stack gap-16" onSubmit={send}><label className="field"><span>Category</span><AppSelect value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}><option value="suggestion">Suggestion</option><option value="bug">Report a bug</option><option value="question">Question</option></AppSelect></label><label className="field"><span>Subject</span><input required maxLength={160} value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })}/></label><label className="field"><span>Details</span><textarea required rows={7} maxLength={10000} value={form.content} onChange={e => setForm({ ...form, content: e.target.value })}/></label>{error && <div className="form-error" role="alert">{error}</div>}<button className="button primary" disabled={busy || !form.subject.trim() || !form.content.trim()}><Send size={16}/>{busy ? 'Sending...' : 'Send feedback'}</button></form></Modal>
  </div>
}
