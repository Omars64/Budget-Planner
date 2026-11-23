import { useEffect, useState } from 'react'
import { ArrowLeft, ChevronRight } from 'lucide-react'
import { api } from '../lib/api'
import { signinTime } from '../lib/signinTime'
import './Announcements.css'

const endpoint = '/api/announcements'

export default function NotificationAnnouncements({ onBack, onRead }) {
  const [rows, setRows] = useState([])
  const [next, setNext] = useState(null)
  const [before, setBefore] = useState(null)
  const [opened, setOpened] = useState(null)
  const [busy, setBusy] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [readError, setReadError] = useState('')
  const [retry, setRetry] = useState(0)
  const message = rows.find(row => row.id === opened)
  const unreadId = message && !message.read ? message.id : null

  useEffect(() => {
    const controller = new AbortController()
    setBusy(true)
    setLoadError('')
    api(before ? `${endpoint}?before=${before}` : endpoint, { signal: controller.signal }).then(page => {
      if (controller.signal.aborted) return
      setRows(current => [...current, ...page.items.filter(row => !current.some(entry => entry.id === row.id))])
      setNext(page.next)
    }).catch(error => { if (!controller.signal.aborted) setLoadError(error.message) })
      .finally(() => { if (!controller.signal.aborted) setBusy(false) })
    return () => controller.abort()
  }, [before, retry])

  useEffect(() => {
    if (unreadId === null) return
    let active = true
    setReadError('')
    api(`${endpoint}/${unreadId}/read`, { method: 'PUT' }).then(() => {
      onRead()
      if (active) setRows(current => current.map(row => row.id === unreadId ? { ...row, read: true } : row))
    }).catch(error => { if (active) setReadError(error.message) })
    return () => { active = false }
  }, [unreadId, onRead, retry])

  return <div className="stack gap-12">
    <div className="button-row"><button type="button" className="button ghost" onClick={message ? () => setOpened(null) : onBack}>
      <ArrowLeft size={16}/> {message ? 'All announcements' : 'Notifications'}
    </button></div>
    {message ? <article className="stack gap-12">
      <h4 tabIndex={-1} ref={heading => heading?.focus({ preventScroll: true })}>{message.title}</h4>
      <small className="muted">{signinTime(message.created_at)}</small>
      <p className="announcement-message">{message.message}</p>
      {readError && <div className="form-error" role="alert">{readError} <button type="button" className="button ghost" onClick={() => setRetry(value => value + 1)}>Retry marking as read</button></div>}
    </article> : <>
      <div className="notification-inbox">
        {rows.map(row => <button type="button" key={row.id} className="notification-inbox-link" onClick={() => setOpened(row.id)}>
          <span><strong>{row.title}</strong><small>{signinTime(row.created_at)}</small></span>
          {!row.read && <span className="bank-inbox-badge">New</span>}<ChevronRight size={17} aria-hidden="true"/>
        </button>)}
      </div>
      {busy && <p className="muted" role="status">Loading announcements…</p>}
      {loadError && <div className="form-error" role="alert">{loadError} <button type="button" className="button ghost" onClick={() => setRetry(value => value + 1)}>Retry</button></div>}
      {!busy && !loadError && !rows.length && <p className="muted">No announcements yet.</p>}
      {next && !loadError && <button type="button" className="button secondary" disabled={busy} onClick={() => setBefore(next)}>Show older messages</button>}
    </>}
  </div>
}
