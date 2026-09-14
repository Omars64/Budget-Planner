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
      if (!status.enabled && !await confirm('Enable paid AI for everyone? Messages, recent chat context, and selected wallet activity will be sent to OpenAI GPT-4o mini. Usage is billed to the OpenAI organization/project owning the configured API key, separately from ChatGPT. No bank payments or record changes are performed.')) return
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
    {status && !status.model_valid && <p role="alert">Set OPENAI_MODEL to gpt-4o-mini and redeploy. Other models are blocked.</p>}
    <p className="muted">OpenAI API usage is paid by the organization/project owning the server API key. A ChatGPT subscription does not cover it. Budgetly permits up to 50 AI requests per day across all users and up to 1,800 output tokens per answer.</p>
    <p className="muted">Only administrators can change this setting. Limits or outages fall back to built-in answers. Disabling stops new AI requests; an already-sent request can still finish and incur charges.</p>
    <div className="button-row"><a href="https://platform.openai.com/usage" target="_blank" rel="noreferrer">API usage</a><a href="https://platform.openai.com/settings/organization/billing/overview" target="_blank" rel="noreferrer">Billing</a></div>
  </div>
}
