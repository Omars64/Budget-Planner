import AppSelect from './AppSelect'
import { useState } from 'react'
import { ChevronRight, RotateCcw } from 'lucide-react'
import SettingsSection from './SettingsSection'
import WelcomeGreeting from './WelcomeGreeting'
import { saveWelcomeSpeed, useWelcomeSpeed, welcomeSpeeds } from '../lib/welcomeAnimation'

export default function WelcomeAnimationSettings() {
  const speed = useWelcomeSpeed()
  const [replay, setReplay] = useState(0)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  return <SettingsSection title="Welcome animation" settingsId="appearance">
    <details className="settings-section welcome-animation-settings">
      <summary><span>Greeting animation speed</span><ChevronRight size={18} aria-hidden="true"/></summary>
      <div className="settings-section-body stack gap-16">
        <p className="muted">Choose how quickly the handwritten Budgetly greeting appears. Saved automatically on this device, including after sign-out.</p>
        <label className="field"><span>Animation speed</span><AppSelect value={speed} onChange={event => { try { saveWelcomeSpeed(Number(event.target.value)); setReplay(value => value + 1); setError(''); setStatus('Greeting speed saved on this device.') } catch { setError('Allow device storage to save your greeting preference.'); setStatus('') } }}>{welcomeSpeeds.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</AppSelect></label>
        <div className="welcome-animation-preview"><WelcomeGreeting duration={speed} replay={replay}/></div>
        <button type="button" className="button ghost small" onClick={() => setReplay(value => value + 1)}><RotateCcw size={16}/>Replay greeting</button>
        <small className="muted">Reduced motion and Motion Off show the greeting immediately. Signing in never waits for the animation.</small>
        <p role="status" className="settings-save-status">{status}</p>
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
    </details>
  </SettingsSection>
}
