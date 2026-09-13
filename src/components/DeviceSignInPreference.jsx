import { useState } from 'react'
import { passwordOnlyEnabled, setPasswordOnly } from '../lib/biometric'

export default function DeviceSignInPreference({ disabled, onChange }) {
  const [enabled, setEnabled] = useState(passwordOnlyEnabled)
  const [error, setError] = useState('')
  return <div className="device-signin-preference stack gap-10">
    <label className="check-row">
      <input type="checkbox" checked={enabled} disabled={disabled} onChange={e => {
        try {
          setPasswordOnly(e.target.checked)
          setEnabled(e.target.checked)
          setError('')
          onChange?.(e.target.checked)
        } catch { setError('Allow site storage to save your sign-in preference.') }
      }}/>
      <span>Use password only on this device</span>
    </label>
    {enabled && <small className="muted">Passkey prompts are off in this browser. Your account and other devices are unchanged.</small>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </div>
}
