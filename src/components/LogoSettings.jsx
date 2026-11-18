import { useState } from 'react'
import { useApp } from '../App'
import { api, jsonBody } from '../lib/api'
import SettingsSection from './SettingsSection'
import SettingsHelp from './SettingsHelp'
import BrandLogo from './BrandLogo'
import './LogoSettings.css'

const choices = [
  { value: 'current', title: 'Palette wallet' },
  { value: 'legacy', title: 'Legacy blue' },
]

export default function LogoSettings() {
  const { accountSettings, settings, setSettings, notify, iconPalette, iconFollowsPalette, setIconFollowsPalette } = useApp()
  const selected = (accountSettings || settings).logo_style || 'current'
  const [saving, setSaving] = useState(false)

  async function choose(value) {
    if (saving || value === selected) return
    setSaving(true)
    try {
      const updated = await api('/api/settings', { method: 'PUT', ...jsonBody({ logo_style: value }) })
      setSettings(current => ({ ...current, ...updated }))
      notify('App logo updated')
    } catch (error) { notify(error.message, 'error') }
    finally { setSaving(false) }
  }

  return <SettingsSection title="App logo" className="logo-settings" help={<SettingsHelp title="About the app logo">
    <p>Turn off matching to keep your current wallet icon on this device when you change palettes. Choose Legacy blue to use the original logo inside Budgetly.</p>
  </SettingsHelp>}>
    <div className="logo-choices" role="group" aria-label="App logo">
      {choices.map(choice => <button key={choice.value} type="button" className="logo-choice" aria-pressed={selected === choice.value} disabled={saving} onClick={() => choose(choice.value)}>
        <BrandLogo style={choice.value} palette={iconPalette} alt=""/>
        <strong>{choice.title}</strong>
        <span aria-hidden="true" className="logo-choice-indicator" />
      </button>)}
    </div>
    <label className="check-row logo-follow">
      <input type="checkbox" role="switch" checked={iconFollowsPalette} onChange={event => setIconFollowsPalette(event.target.checked)}/>
      <span>Match icon to color palette</span>
    </label>
  </SettingsSection>
}
