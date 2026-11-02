import { useState } from 'react'
import { Fingerprint } from 'lucide-react'
import { biometricSupported } from '../lib/biometric'
import DeviceSignInPreference from './DeviceSignInPreference'
import GoogleSignIn from './GoogleSignIn'
import PasswordInput from './PasswordInput'

export default function BiometricEnrollment({ user, enabled, busy, passwordOnly, onPasswordOnly, password, onPassword, onEnable, onDisable }) {
  const [method, setMethod] = useState(() => user.google_linked || user.has_password === false ? 'google' : 'password')
  const [googleBusy, setGoogleBusy] = useState(false)
  const supported = biometricSupported()
  const blocked = busy || googleBusy
  return <div className="stack gap-12">
    <p className="muted">Register your device fingerprint, face or screen lock as a passkey. {user.google_linked ? 'Google sign-in remains available as a fallback.' : 'Your Budgetly password remains available as a fallback.'}</p>
    <DeviceSignInPreference googleOnly={user.has_password === false} disabled={blocked} onChange={onPasswordOnly}/>
    {passwordOnly ? <p className="muted">Biometrics are turned off on this device. Turn off the sign-in-only setting above to register a passkey.</p> : <>
      {user.google_linked && user.has_password !== false && <fieldset><legend>Confirm your identity using</legend><div className="segment-control" role="group" aria-label="Passkey confirmation method">
        <button type="button" aria-pressed={method === 'google'} disabled={blocked} onClick={() => setMethod('google')}>Google</button>
        <button type="button" aria-pressed={method === 'password'} disabled={blocked} onClick={() => setMethod('password')}>Budgetly password</button>
      </div></fieldset>}
      {method === 'google' ? <>
        <p className="muted">Confirm with your linked Google account first. When you return, your device will ask you to register a passkey. No Budgetly password is needed.</p>
        <GoogleSignIn mode="reauth" disabled={busy || !supported} onBusyChange={setGoogleBusy} onComplete={() => onEnable('google')} unavailableMessage="Google confirmation is unavailable. Check your connection and retry, or choose Budgetly password if you have one."/>
      </> : <>
        <label className="field"><span>Confirm password to register a passkey</span><PasswordInput autoComplete="current-password" value={password} onChange={event => onPassword(event.target.value)}/></label>
        {password.length < 8 && <small className="muted">Enter your Budgetly password above to enable registration.</small>}
        <button type="button" className="button primary" disabled={!supported || blocked || password.length < 8} onClick={() => onEnable('password')}><Fingerprint/>{busy ? 'Registering…' : enabled ? 'Register another passkey' : 'Enable biometric sign-in'}</button>
      </>}
      {!supported && <small className="muted">Passkeys require a supported browser with HTTPS, or a supported Android device with a screen lock.</small>}
    </>}
    {busy && <p role="status">Registering your device passkey…</p>}
    {enabled && <button type="button" className="button ghost" disabled={blocked} onClick={onDisable}>Revoke all passkeys</button>}
  </div>
}
