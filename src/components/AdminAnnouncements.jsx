import { useContext, useEffect, useRef, useState } from 'react'
import AppSelect from './AppSelect'
import { useApp } from '../App'
import { api, jsonBody } from '../lib/api'
import { SettingsVisibleContext } from '../lib/settingsContext'
import { signinTime } from '../lib/signinTime'
import './Announcements.css'

const endpoint = '/api/admin/announcements'
const audiences = { everyone: 'All users and other admins', users: 'Users only', admins: 'Other admins only' }
const blank = { title: '', message: '', audience: 'everyone' }

export default function AdminAnnouncements() {
  const { confirm, notify } = useApp()
  const visible = useContext(SettingsVisibleContext)
  const [form, setForm] = useState(blank)
  const [sent, setSent] = useState(null)
  const [error, setError] = useState('')
  const [historyError, setHistoryError] = useState('')
  const [retry, setRetry] = useState(0)
  const [busy, setBusy] = useState(false)
  const sending = useRef(false)

  useEffect(() => {
    if (!visible) return
    const controller = new AbortController()
    api(endpoint, { signal: controller.signal }).then(rows => {
      if (controller.signal.aborted) return
      setSent(current => [...(current ?? []).filter(row => !rows.some(item => item.id === row.id)), ...rows]
        .sort((a, b) => b.id - a.id).slice(0, 30))
      setHistoryError('')
    }).catch(error => { if (!controller.signal.aborted) setHistoryError(error.message) })
    return () => controller.abort()
  }, [visible, retry])

  async function send(event) {
    event.preventDefault()
    if (sending.current || !form.title.trim() || !form.message.trim()) return
    sending.current = true
    setBusy(true)
    setError('')
    try {
      if (!await confirm(`Send this Budgetly announcement to ${audiences[form.audience].toLowerCase()}?`)) return
      const announcement = await api(endpoint, { method: 'POST', ...jsonBody(form) })
      setSent(current => [announcement, ...(current ?? []).filter(row => row.id !== announcement.id)].slice(0, 30))
      setForm(blank)
      notify(`Message sent to ${announcement.recipient_count} ${announcement.recipient_count === 1 ? 'account' : 'accounts'}`)
    } catch (failure) {
      setError(failure.message)
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  const change = key => event => setForm(current => ({ ...current, [key]: event.target.value }))
  return <div className="stack gap-12">
    <form className="stack gap-12" onSubmit={send}>
      <label className="field"><span>Send to</span><AppSelect value={form.audience} onChange={change('audience')} disabled={busy}>
        {Object.entries(audiences).map(([key, label]) => <option value={key} key={key}>{label}</option>)}
      </AppSelect></label>
      <label className="field"><span>Title</span><input required maxLength={100} value={form.title} onChange={change('title')} disabled={busy}/></label>
      <label className="field"><span>Message</span><textarea required maxLength={2000} rows={5} value={form.message} onChange={change('message')} disabled={busy}/></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="button-row"><button className="button primary" disabled={busy || !form.title.trim() || !form.message.trim()}>{busy ? 'Sending…' : 'Send message'}</button></div>
    </form>
    <h3>Recently sent</h3>
    {historyError && <div className="form-error" role="alert">{historyError} <button type="button" className="button ghost" onClick={() => setRetry(value => value + 1)}>Retry</button></div>}
    {!sent && !historyError && <p className="muted" role="status">Loading sent messages…</p>}
    {sent?.length === 0 && <p className="muted">No announcements sent yet.</p>}
    {sent?.map(row => <details key={row.id} className="form-options">
      <summary>{row.title}</summary>
      <p className="muted">{audiences[row.audience]} · {row.recipient_count} delivered · {signinTime(row.created_at)}</p>
      <p className="announcement-message">{row.message}</p>
    </details>)}
  </div>
}
