import { useEffect, useId, useRef, useState } from 'react'
import { RefreshCw, RotateCcw, Save } from 'lucide-react'
import { api, jsonBody } from '../lib/api'
import { useApp } from '../App'
import './ResourcePolicyPanel.css'
import ResourceDashboard from './ResourceDashboard'
import { policyDefaults } from '../lib/resourcePolicy'

const endpoint = '/api/admin/resource-policy'
const defaults = policyDefaults
const fields = [
  { key: 'client_poll_seconds', label: 'Client refresh interval', unit: 'seconds', min: 15, max: 300, help: 'How often active clients check for updates. Longer intervals can delay updates appearing on other devices.' },
  { key: 'idle_recheck_minutes', label: 'Idle recovery rescan interval', unit: 'minutes', min: 15, max: 1440, help: 'Bounds the recovery rescan interval when no work is due. With external coordination configured, this controls recovery rescans; server-side scheduled recording and background reminders follow the scheduled processing interval below.' },
  { key: 'database_probe_minutes', label: 'Database health probe interval', unit: 'minutes', min: 15, max: 1440, help: 'Time between database health probes. Longer intervals can delay detecting a database availability change.' },
]
const extraFields = [
  { key: 'client_idle_minutes', label: 'Pause refresh after inactivity', unit: 'minutes', min: 5, max: 60, section: 'Client activity', help: 'Background reads pause after this much inactivity. Returning resumes updates immediately; manual saving remains available.' },
  { key: 'ai_global_daily_requests', label: 'AI requests per day for everyone', unit: 'requests', min: 0, max: 1000, section: 'AI limits', help: 'Shared daily request limit. Zero disables new AI requests.' },
  { key: 'ai_user_daily_requests', label: 'AI requests per day per person', unit: 'requests', min: 0, max: 500, section: 'AI limits', help: 'Daily request limit for each person. Zero disables new AI requests.' },
  { key: 'ai_global_minute_requests', label: 'AI requests per minute for everyone', unit: 'requests', min: 1, max: 60, section: 'AI limits', help: 'Limits how quickly new AI requests can start across all users.' },
  { key: 'ai_max_output_tokens', label: 'Maximum AI answer length', unit: 'tokens', min: 128, max: 1800, section: 'AI limits', help: 'Caps generated answer length. Shorter answers may contain less detail.' },
  { key: 'notification_batch_size', label: 'Notifications per batch', unit: 'notifications', min: 1, max: 20, section: 'Notifications', help: 'Maximum notifications processed together.' },
  { key: 'backup_interval_hours', label: 'Backup interval', unit: 'hours', min: 6, max: 24, section: 'Backup policy', help: 'Minimum interval between automated backups (6 to 24 hours). The existing external daily trigger determines actual cadence; this does not make it run more often. Manual Run backup bypasses the interval and duplicate checks and always creates a fresh copy.' },
]
const toggleFields = [
  { key: 'release_notifications_enabled', label: 'Enable release notifications' },
  { key: 'scheduled_notifications_enabled', label: 'Enable scheduled notifications' },
  { key: 'upcoming_notifications_enabled', label: 'Enable upcoming notifications' },
  { key: 'backup_skip_unchanged', label: 'Skip redundant backup uploads' },
]
const intervalFields = [...fields, ...extraFields, { key: 'scheduler_interval_minutes', min: 1, max: 60 }]
const normalizePolicy = policy => ({ ...defaults, ...policy })
const validPolicy = raw => {
  const policy = normalizePolicy(raw)
  return fields.every(({ key }) => raw?.[key] !== undefined) && ['scheduler_enabled', ...toggleFields.map(({ key }) => key)].every(key => typeof policy[key] === 'boolean') && intervalFields.every(({ key, min, max }) => Number.isInteger(policy?.[key]) && policy[key] >= min && policy[key] <= max)
}
const validResponse = value => validPolicy(value?.policy) && typeof value?.revision === 'string' && value.revision.length > 0 && typeof value?.coordination?.configured === 'boolean' && typeof value?.coordination?.healthy === 'boolean'
const copyPolicy = raw => {
  const policy = normalizePolicy(raw)
  return { ...policy }
}

export default function ResourcePolicyPanel() {
  const { confirm } = useApp()
  const id = useId()
  const mounted = useRef(false)
  const [data, setData] = useState(null)
  const [draft, setDraft] = useState(defaults)
  const [busy, setBusy] = useState('loading')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [conflict, setConflict] = useState(false)

  useEffect(() => {
    mounted.current = true
    const controller = new AbortController()
    api(endpoint, { signal: controller.signal }).then(value => {
      if (!validResponse(value)) throw new Error('The resource policy response is incomplete. Reload to try again.')
      if (!controller.signal.aborted) { setData(value); setDraft(copyPolicy(value.policy)) }
    }).catch(err => { if (!controller.signal.aborted) setError(err.message) })
      .finally(() => { if (!controller.signal.aborted) setBusy('') })
    return () => { mounted.current = false; controller.abort() }
  }, [])

  const reload = async () => {
    setBusy('loading'); setError(''); setMessage('')
    try {
      const value = await api(endpoint)
      if (!validResponse(value)) throw new Error('The resource policy response is incomplete. Reload to try again.')
      if (!mounted.current) return
      setData(value); setConflict(false)
      if (!data) setDraft(copyPolicy(value.policy))
      setMessage(data ? 'Latest saved policy loaded. Your draft has been preserved; review it before saving.' : 'Saved resource policy loaded.')
    } catch (err) { if (mounted.current) setError(err.message) }
    finally { if (mounted.current) setBusy('') }
  }

  const numericDraft = { ...draft, ...Object.fromEntries(intervalFields.map(({ key }) => [key, draft[key] === '' ? NaN : Number(draft[key])])), scheduler_enabled: draft.scheduler_enabled }
  const valid = validPolicy(numericDraft)
  const dirty = data && Object.keys(defaults).some(key => numericDraft[key] !== normalizePolicy(data.policy)[key])
  const available = data?.coordination.configured === true
  const disabled = Boolean(busy) || !available

  const save = async event => {
    event.preventDefault()
    if (disabled || !valid || !dirty || conflict || !data?.revision) return
    const policy = copyPolicy(numericDraft)
    const increases = fields.filter(({ key }) => policy[key] > data.policy[key])
    let committed = false
    setBusy('saving'); setError(''); setMessage('')
    try {
      if (increases.length && !await confirm(`Increase these intervals: ${increases.map(({ label, key, unit }) => `${label} to ${policy[key]} ${unit}`).join(', ')}? Client refresh and database health detection may take longer when their intervals increase. The idle interval changes recovery rescans only; server-side scheduled recording and background reminders follow the scheduled processing interval with external coordination configured.`)) return
      if (!mounted.current) return
      const saved = await api(endpoint, { method: 'PUT', ...jsonBody({ policy, revision: data.revision }) })
      committed = true
      if (!mounted.current) return
      const applied = validPolicy(saved?.policy) ? copyPolicy(saved.policy) : policy
      window.dispatchEvent(new CustomEvent('budgetly:resource-policy', { detail: { client_poll_seconds: applied.client_poll_seconds, client_idle_minutes: applied.client_idle_minutes } }))
      // A successful write may have no body; never reuse its now-stale revision.
      setData(current => ({ ...current, policy: applied, revision: '' }))
      setDraft(applied)
      const latest = validResponse(saved) ? saved : await api(endpoint)
      if (!validResponse(latest)) throw new Error('The latest policy response is incomplete.')
      if (!mounted.current) return
      setData(latest); setDraft(copyPolicy(latest.policy)); setMessage('Resource policy saved.')
    } catch (err) {
      if (!mounted.current) return
      if (committed) {
        setError('Policy saved, but its latest revision could not be loaded. Reload before saving again.')
      } else if ([409, 412].includes(err.status)) {
        setConflict(true)
        setError('The saved policy changed. Reload the latest revision, then review and save your preserved draft.')
      } else setError(err.message || 'Could not save the resource policy. Try again.')
    } finally { if (mounted.current) setBusy('') }
  }

  return <section className="resource-policy" aria-labelledby={`${id}-title`} aria-busy={Boolean(busy)}>
    <div className="resource-policy-heading">
      <h3 id={`${id}-title`}>Database usage controls</h3>
      <button type="button" className="button ghost small" disabled={Boolean(busy)} onClick={reload}><RefreshCw size={16} aria-hidden="true"/>Reload latest</button>
    </div>
    <p className="muted">Refresh, recovery, and health-check intervals. These settings do not cap all database activity or report measured database usage.</p>
    {data && <p role="status">External coordination: {!available ? 'Not configured. Controls are unavailable.' : data.coordination.healthy ? 'Configured and healthy.' : 'Configured, but unhealthy. Recovery may be delayed; check service health.'}</p>}
    {available && data?.status && <p className="muted">Scheduler checks: {data.status.runs || 0} database runs, {data.status.skips || 0} idle skips. Pending save confirmations: {data.status.pending_count || 0}.</p>}
    {available && data?.status?.pending_count > 0 && <p role="status">Idle skipping is paused while save confirmations are pending. Scheduled processing continues. If this count persists, check service logs before changing coordination settings.</p>}
    {!data && !busy && <p>Controls are unavailable until the saved policy can be loaded.</p>}
    <form onSubmit={save} noValidate>
      <div className="resource-policy-actions" aria-label="Policy presets">
        {['Balanced', 'Economy', 'Responsive'].map(name => <button type="button" className="button ghost" disabled={disabled} key={name} onClick={() => {
          setDraft(current => {
            const preset = name === 'Economy' ? { client_poll_seconds: 120, scheduler_interval_minutes: 5, idle_recheck_minutes: 360, database_probe_minutes: 120, backup_interval_hours: 24, backup_skip_unchanged: true, ai_global_daily_requests: Math.min(Number(current.ai_global_daily_requests), Number(data.policy.ai_global_daily_requests ?? defaults.ai_global_daily_requests), 25), ai_user_daily_requests: Math.min(Number(current.ai_user_daily_requests), Number(data.policy.ai_user_daily_requests ?? defaults.ai_user_daily_requests), 10), ai_max_output_tokens: Math.min(Number(current.ai_max_output_tokens), Number(data.policy.ai_max_output_tokens ?? defaults.ai_max_output_tokens), 900) } : name === 'Responsive' ? { client_poll_seconds: 30, scheduler_interval_minutes: 1 } : { client_poll_seconds: 60, scheduler_interval_minutes: 1, idle_recheck_minutes: 180, database_probe_minutes: 60, client_idle_minutes: 30 }
            return { ...current, ...preset }
          })
          setMessage(`${name} preset is in the draft. Save to apply it.`)
        }}>{name}</button>)}
      </div>
      <p className="muted">Presets change the draft only. Economy does not re-enable paused services or raise AI limits. Use safe defaults explicitly resets all policy controls.</p>
      <fieldset disabled={disabled} className="resource-policy-fields">
        <legend>Intervals</legend>
        {fields.map(({ key, label, unit, min, max, help }) => <div className="resource-policy-field" key={key}>
          <label htmlFor={`${id}-${key}`}>{label}</label>
          <div className="resource-policy-input"><input id={`${id}-${key}`} type="number" inputMode="numeric" min={min} max={max} step="1" required value={draft[key]} aria-describedby={`${id}-${key}-help`} aria-invalid={draft[key] === '' || !Number.isInteger(numericDraft[key]) || numericDraft[key] < min || numericDraft[key] > max} onChange={event => { setDraft(current => ({ ...current, [key]: event.target.value })); setMessage('') }}/><span>{unit}</span></div>
          <p id={`${id}-${key}-help`} className="muted">{help} Allowed: {min} to {max} {unit}, whole numbers.</p>
        </div>)}
      </fieldset>
      <fieldset disabled={disabled} className="resource-policy-scheduler">
        <legend>Automatic scheduled processing</legend>
        <label className="resource-policy-toggle" htmlFor={`${id}-scheduler-enabled`}>
          <input id={`${id}-scheduler-enabled`} type="checkbox" role="switch" checked={draft.scheduler_enabled} aria-describedby={`${id}-scheduler-help`} onChange={event => { setDraft(current => ({ ...current, scheduler_enabled: event.target.checked })); setMessage('') }}/>
          Enable automatic scheduled processing
        </label>
        <p id={`${id}-scheduler-help`} className="muted">Turning this off pauses server-side scheduled recording and background reminders only. Phone reminders may still appear; local reminders remain a personal device preference. A check already in progress may finish. Backups and manual saving are unaffected. Longer intervals can delay server-side scheduled recording and background reminders. Cron still contacts the service every minute; Upstash coordination skips database work until the interval is due.</p>
        <div className="resource-policy-field">
          <label htmlFor={`${id}-scheduler-interval`}>Scheduled processing interval</label>
          <div className="resource-policy-input"><input id={`${id}-scheduler-interval`} type="number" inputMode="numeric" min="1" max="60" step="1" required value={draft.scheduler_interval_minutes} aria-describedby={`${id}-scheduler-interval-help`} aria-invalid={!Number.isInteger(numericDraft.scheduler_interval_minutes) || numericDraft.scheduler_interval_minutes < 1 || numericDraft.scheduler_interval_minutes > 60} onChange={event => { setDraft(current => ({ ...current, scheduler_interval_minutes: event.target.value })); setMessage('') }}/><span>minutes</span></div>
          <p id={`${id}-scheduler-interval-help`} className="muted">Allowed: 1 to 60 minutes, whole numbers. Applies when automatic processing is enabled.</p>
        </div>
      </fieldset>
      {['Client activity', 'AI limits', 'Notifications', 'Backup policy'].map(section => <fieldset key={section} disabled={disabled} className="resource-policy-fields">
        <legend>{section}</legend>
        {extraFields.filter(field => field.section === section).map(({ key, label, min, max, unit, help }) => <div className="resource-policy-field" key={key}>
          <label htmlFor={`${id}-${key}`}>{label}</label>
          <div className="resource-policy-input"><input id={`${id}-${key}`} type="number" min={min} max={max} step="1" required value={draft[key]} aria-describedby={`${id}-${key}-help`} aria-invalid={!Number.isInteger(numericDraft[key]) || numericDraft[key] < min || numericDraft[key] > max} onChange={event => { setDraft(current => ({ ...current, [key]: event.target.value })); setMessage('') }}/><span>{unit}</span></div>
          <p className="muted" id={`${id}-${key}-help`}>{help} Allowed: {min} to {max}, whole numbers.</p>
        </div>)}
        {toggleFields.filter(({ key }) => section === 'Notifications' ? key.endsWith('_enabled') : section === 'Backup policy' && key === 'backup_skip_unchanged').map(({ key, label }) => <label className="resource-policy-toggle" key={key}><input type="checkbox" role="switch" checked={draft[key]} onChange={event => { setDraft(current => ({ ...current, [key]: event.target.checked })); setMessage('') }}/>{label}</label>)}
        {section === 'Notifications' && <p className="muted">These controls apply to server delivery only. Native phone local reminders remain independent. Device notification opt-ins are still respected.</p>}
        {section === 'Backup policy' && <p className="muted">Skip unchanged compares current account records and identity metadata, then authenticates and reads back the prior complete backup before skipping redundant storage uploads. Export records are still read. A full encrypted copy is created at least every 7 days. No backups are deleted by this policy.</p>}
      </fieldset>)}
      <p className="muted">Safe defaults: client refresh 60 seconds, idle recovery rescan 180 minutes, database health probe 60 minutes; automatic scheduled processing on, every 1 minute. Defaults are applied only when saved.</p>
      {!valid && <p className="form-error" role="alert">Enter whole numbers within each interval's allowed range.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {(busy || message) && <p role="status">{busy === 'loading' ? 'Loading resource policy...' : busy === 'saving' ? 'Saving resource policy...' : message}</p>}
      <div className="resource-policy-actions">
        <button type="button" className="button ghost" disabled={disabled} onClick={() => { setDraft(current => ({ ...current, ...defaults })); setMessage('Safe defaults are in the draft. Save to apply them.') }}><RotateCcw size={16} aria-hidden="true"/>Use safe defaults</button>
        <button type="submit" className="button primary" disabled={disabled || !valid || !dirty || conflict || !data?.revision}><Save size={16} aria-hidden="true"/>{busy === 'saving' ? 'Saving...' : 'Save policy'}</button>
      </div>
    </form>
    <ResourceDashboard status={data?.status} />
  </section>
}
