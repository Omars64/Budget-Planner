import { useState } from 'react'
import { Download, LogIn, Save, Trash2 } from 'lucide-react'
import { useApp } from '../App'
import { api, jsonBody } from '../lib/api'
import { clearGuest, guestCsv, GUEST_KEY, GUEST_IMPORT_KEY } from '../lib/guest'
import { saveDownload } from '../lib/download'
import SettingsSection from '../components/SettingsSection'
import ComfortSettings from '../components/ComfortSettings'
import WorkspacePreferences from '../components/WorkspacePreferences'
import AccentPicker from '../components/AccentPicker'

export default function GuestSettings() {
  const { settings, setSettings, refresh, notify, confirm, requestSignIn } = useApp()
  const [form, setForm] = useState(settings)
  const save = async event => {
    event.preventDefault()
    try { const result = await api('/api/settings', { method: 'PUT', ...jsonBody(form) }); setSettings(result); refresh(); notify('Preferences saved on this device') }
    catch (error) { notify(error.message, 'error') }
  }
  const exportData = async format => {
    try {
      const raw = format === 'csv' ? guestCsv() : localStorage.getItem(GUEST_KEY)
      await saveDownload(new Blob([raw || '{}'], { type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json' }), `Budgetly-guest-${new Date().toISOString().slice(0, 10)}.${format}`)
      notify('Guest records exported')
    } catch (error) { notify(error.message, 'error') }
  }
  return <div className="settings-grid">
    <SettingsSection title="Guest workspace"><p>Stored only on this device. Clearing browser storage or uninstalling can remove these records.</p><button className="button primary" onClick={() => requestSignIn('cloud storage and account features')}><LogIn size={18}/>Sign in or create an account</button></SettingsSection>
    <SettingsSection title="Personal preferences"><ComfortSettings/><WorkspacePreferences/><form className="stack gap-16" onSubmit={save}>
      <label className="field"><span>Appearance</span><select aria-label="Appearance" value={form.theme} onChange={event => setForm({ ...form, theme: event.target.value })}><option value="system">Match device</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
      <AccentPicker value={form.accent_color || '#0a4173'} onChange={value => setForm({ ...form, accent_color: value })}/>
      <label className="field"><span>Currency</span><select aria-label="Currency" value={form.currency} onChange={event => setForm({ ...form, currency: event.target.value })}>{['KWD', 'USD', 'EUR', 'GBP', 'INR', 'AED', 'SAR'].map(value => <option key={value}>{value}</option>)}</select></label>
      <label className="field"><span>Wallpaper</span><select aria-label="Wallpaper" value={form.wallpaper_style} onChange={event => setForm({ ...form, wallpaper_style: event.target.value, wallpaper_enabled: event.target.value !== 'none' })}><option value="none">None</option><option value="budgetly">Budgetly</option></select></label>
      <label className="check-row"><input type="checkbox" checked={form.compact_numbers} onChange={event => setForm({ ...form, compact_numbers: event.target.checked })}/><span>Compact numbers</span></label>
      <button className="button primary"><Save size={17}/>Save preferences</button>
    </form></SettingsSection>
    <SettingsSection title="Export and local data"><div className="button-row"><button className="button ghost" onClick={() => exportData('csv')}><Download size={17}/>CSV transactions</button><button className="button ghost" onClick={() => exportData('json')}><Download size={17}/>Full local copy</button></div><button className="button danger" onClick={async () => { if (localStorage.getItem(GUEST_IMPORT_KEY)) { notify('Finish the pending import before clearing guest records.','error'); return } if (await confirm('Permanently clear guest records on this device? Export them first. There is no deleted-item recovery in Guest Mode.')) { clearGuest(); refresh(); notify('Guest records cleared') } }}><Trash2 size={17}/>Clear guest records</button></SettingsSection>
    <SettingsSection title="Account features"><p>Sign in for security, biometrics, reminders, deleted-item recovery and cloud backups.</p><button className="button ghost" onClick={() => requestSignIn('account features')}>Continue with an account</button></SettingsSection>
  </div>
}
