import { useState } from 'react'
import { useApp } from '../App'
import { api, jsonBody } from '../lib/api'
import SettingsSection from './SettingsSection'
import './LogoSettings.css'

const choices = [
  { value: 'current', title: 'New wallet', image: '/flowbudget-logo.png' },
  { value: 'legacy', title: 'Legacy blue', image: '/flowbudget-logo-legacy.png' },
]

export default function LogoSettings() {
  const { accountSettings, settings, setSettings, notify } = useApp()
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

  return <SettingsSection title="App logo" className="logo-settings">
    <p className="muted">Choose the logo shown inside Budgetly. The Android and installed app icons use the new wallet logo.</p>
    <div className="logo-choices" role="group" aria-label="App logo">
      {choices.map(choice => <button key={choice.value} type="button" className="logo-choice" aria-pressed={selected === choice.value} disabled={saving} onClick={() => choose(choice.value)}>
        <img src={choice.image} alt="" width="64" height="64" />
        <strong>{choice.title}</strong>
        <span aria-hidden="true" className="logo-choice-indicator" />
      </button>)}
    </div>
  </SettingsSection>
}
