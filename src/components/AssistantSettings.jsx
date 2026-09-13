import { useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { api, jsonBody } from '../lib/api'
import { useApp } from '../App'

export default function AssistantSettings() {
  const { notify, confirm } = useApp()
  const [status, setStatus] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const load = async () => {
    try { setStatus(await api('/api/admin/assistant')); setError('') }
    catch (err) { setError(err.message) }
  }
  useEffect(() => { void load() }, [])
  const toggle = async () => {
    if (lock.current || !status) return
    lock.current = true
    setBusy(true)
    try {
      if (!status.enabled && !await confirm('Enable AI for everyone? New messages, recent chat context, and selected wallet activity will be sent to OpenRouter and its free-model provider. No payments or record changes are performed.')) return
      setStatus(await api('/api/admin/assistant', { method: 'PUT', ...jsonBody({ enabled: !status.enabled }) }))
      setError('')
      notify(status.enabled ? 'AI disabled. Built-in guidance remains available.' : 'AI enabled for Ask Budgetly')
    } catch (err) { setError(err.message) }
    finally { lock.current = false; setBusy(false) }
  }
  return <div className="assistant-settings stack gap-16">
    <div className="assistant-policy-row"><label className="check-row"><input type="checkbox" role="switch" checked={!!status?.enabled} disabled={busy || !status || (!status.enabled && (!status.configured || !status.model_valid))} onChange={toggle}/><span>Enable AI for all users</span></label><button className="icon-button" aria-label="Refresh AI configuration" title="Refresh AI configuration" disabled={busy} onClick={load}><RefreshCw size={18}/></button></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {!status && !error && <p role="status">Loading configuration...</p>}
    {status && <p className="muted">{status.configured ? 'API key configured.' : 'API key not configured.'} Model: <code>{status.model}</code>. {status.available ? 'AI is available.' : 'Built-in guidance is active.'}</p>}
    {status && !status.model_valid && <p role="alert">Set OPENROUTER_MODEL to openrouter/free and redeploy. Other models are blocked.</p>}
    <p className="muted">Only administrators can change this setting. Free service limits or outages fall back to built-in answers. Disabling stops new AI requests; a request already sent may finish.</p>
  </div>
}
