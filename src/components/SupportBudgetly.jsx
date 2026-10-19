import { useState } from 'react'
import { Coffee, ExternalLink } from 'lucide-react'
import { useApp } from '../App'
import { api, jsonBody } from '../lib/api'
import SettingsSection from './SettingsSection'
import { SUPPORT_URL } from '../lib/support'

export default function SupportBudgetly() {
  const { user, accountSettings, settings, setSettings, notify } = useApp()
  const preferences = accountSettings || settings
  const [busy, setBusy] = useState(false)
  async function toggle(key, value) {
    if (busy) return
    setBusy(true)
    try {
      const saved = await api('/api/settings', { method: 'PUT', ...jsonBody({ [key]: value }) })
      setSettings(current => ({ ...current, ...saved }))
      notify('Support preference saved')
    } catch (error) { notify(error.message, 'error') }
    finally { setBusy(false) }
  }
  return <SettingsSection title="Buy me a coffee">
    <div className="stack gap-16">
      <label className="check-row"><input type="checkbox" role="switch" checked={preferences.support_popup_enabled !== false} disabled={busy} onChange={event => toggle('support_popup_enabled', event.target.checked)}/><span>Show support popup after sign-in</span></label>
      {user?.role === 'admin' && <div className="stack gap-10"><h4>Administrator preferences</h4><label className="check-row"><input type="checkbox" role="switch" checked={preferences.support_sidebar_enabled !== false} disabled={busy} onChange={event => toggle('support_sidebar_enabled', event.target.checked)}/><span>Show support link in my sidebar</span></label><small className="muted">Only your sidebar is affected. Other users keep their support link.</small></div>}
      <p className="muted">Enjoying Budgetly? You can support its ongoing development with an optional tip. Your access to the app stays the same whether you tip or not.</p>
      <a className="button primary self-start" href={SUPPORT_URL} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"><Coffee size={18}/>Support on Ko-fi<ExternalLink size={16}/></a>
      <small className="muted">Payments are handled on Ko-fi through the creator's connected payment provider, outside Budgetly.</small>
    </div>
  </SettingsSection>
}
