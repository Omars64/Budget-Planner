import { useState } from 'react'
import { Check } from 'lucide-react'
import { useApp } from '../App'
import { api, jsonBody } from '../lib/api'
import { colorPalettes, paletteKey } from '../lib/colorPalettes'
import SettingsSection from './SettingsSection'
import AppSelect from './AppSelect'

export default function PaletteSettings() {
  const { settings, setSettings, notify } = useApp()
  const [saving, setSaving] = useState(false)
  const current = paletteKey(settings.color_palette)
  const saveAppearance = async patch => {
    if (saving) return
    setSaving(true)
    try {
      const updated = await api('/api/settings', { method:'PUT', ...jsonBody(patch) })
      setSettings(value => ({ ...value, ...updated }))
    } catch (error) { notify(error.message,'error') }
    finally { setSaving(false) }
  }
  return <div className="palette-settings">
    <label className="field palette-appearance"><span>Appearance</span><AppSelect aria-label="Appearance" disabled={saving} value={settings.theme || 'light'} onChange={event => saveAppearance({ theme:event.target.value })}><option value="light">Light mode</option><option value="dark">Dark mode</option><option value="system">Match device</option></AppSelect></label>
    <SettingsSection title="Color palette">
    <p className="muted">Choose colors for the app and welcome screen. Your light, dark, or device appearance preference is separate.</p>
    <div className="palette-picker" role="group" aria-label="Color palette" aria-busy={saving}>
      {Object.entries(colorPalettes).map(([key,{name,deep,light,bright}]) =>
        <button key={key} type="button" className="palette-choice" aria-pressed={current === key} disabled={saving} onClick={() => current !== key && saveAppearance({ color_palette:key, accent_color:'#0a4173' })}>
          <span className="palette-samples" aria-hidden="true"><i style={{background:deep}}/><i style={{background:light}}/><i style={{background:bright}}/></span>
          <strong>{name}</strong>{current === key && <Check size={17} aria-hidden="true"/>}
        </button>)}
    </div>
    <small className="muted">Choosing a different palette restores its accent color.</small>
    </SettingsSection>
  </div>
}
