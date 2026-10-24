import { useEffect, useId, useRef, useState } from 'react'
import { RefreshCw, RotateCcw, Save } from 'lucide-react'
import { api, jsonBody } from '../lib/api'
import { useApp } from '../App'
import './ResourcePolicyPanel.css'

const endpoint = '/api/admin/resource-policy'
const defaults = { client_poll_seconds: 60, idle_recheck_minutes: 180, database_probe_minutes: 60 }
const fields = [
  { key: 'client_poll_seconds', label: 'Client refresh interval', unit: 'seconds', min: 15, max: 300, help: 'How often active clients check for updates. Longer intervals can delay updates appearing on other devices.' },
  { key: 'idle_recheck_minutes', label: 'Idle recovery rescan interval', unit: 'minutes', min: 15, max: 1440, help: 'Bounds the recovery rescan interval when no work is due. With external coordination configured, scheduled tasks still use their next-due wake; this does not reduce normal due-time precision.' },
  { key: 'database_probe_minutes', label: 'Database health probe interval', unit: 'minutes', min: 15, max: 1440, help: 'Time between database health probes. Longer intervals can delay detecting a database availability change.' },
]
const validPolicy = policy => fields.every(({ key, min, max }) => Number.isInteger(policy?.[key]) && policy[key] >= min && policy[key] <= max)
const validResponse = value => validPolicy(value?.policy) && typeof value?.revision === 'string' && value.revision.length > 0 && typeof value?.coordination?.configured === 'boolean' && typeof value?.coordination?.healthy === 'boolean'
const copyPolicy = policy => Object.fromEntries(fields.map(({ key }) => [key, policy[key]]))

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

  const numericDraft = Object.fromEntries(fields.map(({ key }) => [key, draft[key] === '' ? NaN : Number(draft[key])]))
  const valid = validPolicy(numericDraft)
  const dirty = data && fields.some(({ key }) => numericDraft[key] !== data.policy[key])
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
      if (increases.length && !await confirm(`Increase these intervals: ${increases.map(({ label, key, unit }) => `${label} to ${policy[key]} ${unit}`).join(', ')}? Client refresh and database health detection may take longer when their intervals increase. The idle interval changes recovery rescans only; scheduled tasks still use their next-due wake with external coordination configured.`)) return
      if (!mounted.current) return
      const saved = await api(endpoint, { method: 'PUT', ...jsonBody({ policy, revision: data.revision }) })
      committed = true
      if (!mounted.current) return
      const applied = validPolicy(saved?.policy) ? copyPolicy(saved.policy) : policy
      window.dispatchEvent(new CustomEvent('budgetly:resource-policy', { detail: { client_poll_seconds: applied.client_poll_seconds } }))
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
      <fieldset disabled={disabled} className="resource-policy-fields">
        <legend>Intervals</legend>
        {fields.map(({ key, label, unit, min, max, help }) => <div className="resource-policy-field" key={key}>
          <label htmlFor={`${id}-${key}`}>{label}</label>
          <div className="resource-policy-input"><input id={`${id}-${key}`} type="number" inputMode="numeric" min={min} max={max} step="1" required value={draft[key]} aria-describedby={`${id}-${key}-help`} aria-invalid={draft[key] === '' || !Number.isInteger(numericDraft[key]) || numericDraft[key] < min || numericDraft[key] > max} onChange={event => { setDraft(current => ({ ...current, [key]: event.target.value })); setMessage('') }}/><span>{unit}</span></div>
          <p id={`${id}-${key}-help`} className="muted">{help} Allowed: {min} to {max} {unit}, whole numbers.</p>
        </div>)}
      </fieldset>
      <p className="muted">Safe defaults: client refresh 60 seconds, idle recovery rescan 180 minutes, database health probe 60 minutes. Defaults are applied only when saved.</p>
      {!valid && <p className="form-error" role="alert">Enter whole numbers within each interval's allowed range.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {(busy || message) && <p role="status">{busy === 'loading' ? 'Loading resource policy...' : busy === 'saving' ? 'Saving resource policy...' : message}</p>}
      <div className="resource-policy-actions">
        <button type="button" className="button ghost" disabled={disabled} onClick={() => { setDraft({ ...defaults }); setMessage('Safe defaults are in the draft. Save to apply them.') }}><RotateCcw size={16} aria-hidden="true"/>Use safe defaults</button>
        <button type="submit" className="button primary" disabled={disabled || !valid || !dirty || conflict || !data?.revision}><Save size={16} aria-hidden="true"/>{busy === 'saving' ? 'Saving...' : 'Save policy'}</button>
      </div>
    </form>
  </section>
}
