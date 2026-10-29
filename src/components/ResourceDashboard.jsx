import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
const labels = { ai_attempts: 'AI attempts', ai_successes: 'AI successes', ai_fallbacks: 'AI fallbacks', ai_input_tokens: 'AI input tokens', ai_output_tokens: 'AI output tokens', backup_upload_runs: 'Backup uploads', backup_unchanged_runs: 'Unchanged backups', backup_interval_skips: 'Backup interval skips', notification_sent: 'Notifications sent', notification_failed: 'Notifications failed', notification_paused: 'Notifications paused' }
const count = value => Number.isSafeInteger(value) && value >= 0
const show = value => typeof value === 'boolean' ? (value ? 'On' : 'Off') : ['string', 'number'].includes(typeof value) ? String(value).slice(0, 160) : 'Unavailable'
const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const localDate = value => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Unavailable'
  const date = new Date(value * 1000)
  return Number.isNaN(date.getTime()) ? 'Unavailable' : dateTime.format(date)
}
const actor = value => value === 'system' ? 'System' : typeof value === 'number' || (typeof value === 'string' && value.length > 0) ? `Admin #${show(value)}` : 'Unavailable'
export default function ResourceDashboard({ status }) {
  const mounted = useRef(false)
  const [data, setData] = useState({})
  const [busy, setBusy] = useState({})
  const [errors, setErrors] = useState({})
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const refresh = async kind => {
    setBusy(current => ({ ...current, [kind]: true }))
    setErrors(current => ({ ...current, [kind]: '' }))
    try {
      const result = await api(kind === 'history' ? '/api/admin/resource-policy/history' : '/api/admin/resource-metrics')
      const value = kind === 'history' ? result?.items : result?.metrics
      if (kind === 'history' ? !Array.isArray(value) : !value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Response is incomplete.')
      if (mounted.current) setData(current => ({ ...current, [kind]: kind === 'history' ? value.slice(0, 20) : value, ...(kind === 'metrics' ? { since: result.since, reset_at: result.reset_at } : {}) }))
    } catch (error) { if (mounted.current) setErrors(current => ({ ...current, [kind]: error.message || 'Refresh failed.' })) }
    finally { if (mounted.current) setBusy(current => ({ ...current, [kind]: false })) }
  }
  const entries = Object.entries(labels).filter(([key]) => count(data.metrics?.[key]))
  return <section className="resource-dashboard" aria-label="Resource activity">
    <h4>Resource activity</h4><p className="muted">Recorded activity only. These counts do not measure provider charges. Refresh when needed.</p>
    {status && <p>Scheduler actual runs: {count(status.runs) ? status.runs : 'Unavailable'}. Scheduler skips: {count(status.skips) ? status.skips : 'Unavailable'}.</p>}
    <button type="button" className="button ghost" disabled={busy.metrics} onClick={() => refresh('metrics')}>Refresh metrics</button>
    {errors.metrics && <p role="status">Metrics: {errors.metrics}</p>}
    {data.metrics && <><p>Tracking started: {localDate(data.since)}. Last reset: {localDate(data.reset_at)}.</p>{!entries.length ? <p>Metrics unavailable.</p> : <dl>{entries.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{data.metrics[key]}</dd></div>)}</dl>}</>}
    <h4>Recent policy changes</h4><button type="button" className="button ghost" disabled={busy.history} onClick={() => refresh('history')}>Refresh history</button>
    {errors.history && <p role="status">History: {errors.history}</p>}
    {data.history && <><p className="muted">Up to 20 recent changes. Refresh to update.</p>{!data.history.length && <p>No recent changes.</p>}<ol>{data.history.map((item, index) => <li key={index}>{localDate(item?.at)} - {actor(item?.actor_id)}<ul>{Object.entries(item?.changes && typeof item.changes === 'object' ? item.changes : {}).slice(0, 30).map(([field, change]) => <li key={field}>{field.replaceAll('_', ' ')}: {show(change?.before)} to {show(change?.after)}</li>)}</ul></li>)}</ol></>}
  </section>
}
