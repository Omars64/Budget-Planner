import { useRef, useState } from 'react'
import { useApp } from '../App'
import { api, jsonBody } from '../lib/api'
import AppSelect from './AppSelect'

export default function AppearancePreferences({ guest = false }) {
  const { settings, setSettings } = useApp()
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const pending = useRef(false)

  async function save(fields) {
    if (pending.current) return
    pending.current = true
    setSaving(true)
    setStatus('')
    setError('')
    try {
      const saved = await api('/api/settings', { method:'PUT', ...jsonBody(fields) })
      const changes = Object.fromEntries(Object.keys(fields).map(key => [key, saved[key] ?? fields[key]]))
      setSettings(current => ({ ...current, ...changes }))
      setStatus('Preference saved.')
    } catch (failure) {
      setError(failure.message || 'Could not save the preference. Try again.')
    } finally {
      pending.current = false
      setSaving(false)
    }
  }

  return <div className="stack gap-16" aria-busy={saving}>
    {guest ? <>
      <label className="field"><span>Wallpaper</span><AppSelect disabled={saving} value={settings.wallpaper_style || 'none'} onChange={event => void save({ wallpaper_style:event.target.value, wallpaper_enabled:event.target.value !== 'none' })}><option value="none">None</option><option value="budgetly">Budgetly</option></AppSelect></label>
      <label className="check-row"><input type="checkbox" disabled={saving} checked={Boolean(settings.compact_numbers)} onChange={event => void save({ compact_numbers:event.target.checked })}/><span>Compact numbers</span></label>
    </> : <>
      <label className="field"><span>Font</span><AppSelect disabled={saving} value={settings.font_family || 'system'} onChange={event => void save({ font_family:event.target.value })}><option value="system">System</option><option value="arial">Arial</option><option value="georgia">Georgia</option><option value="verdana">Verdana</option></AppSelect></label>
      <label className="field"><span>Text colour</span><AppSelect disabled={saving} value={settings.text_color || 'ink'} onChange={event => void save({ text_color:event.target.value })}><option value="ink">Ink</option><option value="charcoal">Charcoal</option><option value="forest">Forest</option></AppSelect></label>
    </>}
    {error && <p role="alert" className="form-error">{error}</p>}
    <p role="status" className="sr-only">{saving ? 'Saving preference…' : status}</p>
  </div>
}
