import { useEffect, useState } from 'react'
import { CheckCircle2, Fingerprint } from 'lucide-react'
import { biometricSupported } from '../lib/biometric'
import DeviceSignInPreference from './DeviceSignInPreference'
import GoogleSignIn from './GoogleSignIn'
import PasswordInput from './PasswordInput'
import SettingsHelp from './SettingsHelp'

export default function BiometricEnrollment({ user, enabled, busy, passwordOnly, onPasswordOnly, password, onPassword, onEnable, onDisable }) {
  const [method, setMethod] = useState(() => user.google_linked || user.has_password === false ? 'google' : 'password')
  const [googleBusy, setGoogleBusy] = useState(false)
  const [verifiedUntil, setVerifiedUntil] = useState(0)
  const [registrationError, setRegistrationError] = useState('')
  useEffect(() => {
    if (!verifiedUntil) return
    const timer = setTimeout(() => setVerifiedUntil(0), Math.max(0, verifiedUntil - Date.now()))
    return () => clearTimeout(timer)
  }, [verifiedUntil])
  const supported = biometricSupported()
  const blocked = busy || googleBusy
  const register = async () => {
    setRegistrationError('')
    if (method === 'google' && Date.now() >= verifiedUntil) {
      setVerifiedUntil(0); setRegistrationError('Confirm with Google again before registering this device.'); return
    }
    await onEnable(method)
  }
  return <div className="biometric-enrollment stack gap-12">
    <DeviceSignInPreference googleOnly={user.has_password === false} disabled={blocked} onChange={onPasswordOnly}/>
    {passwordOnly ? <p className="muted">Biometrics are turned off on this device. Turn off the sign-in-only setting above to register a passkey.</p> : <>
      {user.google_linked && user.has_password !== false && <fieldset><legend>Confirm your identity using</legend><div className="segment-control" role="group" aria-label="Passkey confirmation method">
        <button type="button" aria-pressed={method === 'google'} disabled={blocked} onClick={() => setMethod('google')}>Google</button>
        <button type="button" aria-pressed={method === 'password'} disabled={blocked} onClick={() => setMethod('password')}>Budgetly password</button>
      </div></fieldset>}
      <div className="settings-help-row">
        <div className="biometric-steps" aria-label="Registration steps"><span className={method === 'google' && verifiedUntil > Date.now() ? '' : 'active'}><b>1</b>Verify account</span><span aria-hidden="true">→</span><span className={method === 'google' && verifiedUntil > Date.now() ? 'active' : ''}><b>2</b>Register device</span></div>
        {method === 'google' && <SettingsHelp title="Using Google to verify your account"><p>Confirm with your linked Google account, then register your device. You can do this without a Budgetly password.</p></SettingsHelp>}
      </div>
      {method === 'google' ? <>
        {verifiedUntil > Date.now() ? <p className="biometric-verified" role="status"><CheckCircle2 size={18}/>Google account confirmed. Ready to register this device.</p> : <GoogleSignIn mode="reauth" disabled={busy || !supported} onBusyChange={setGoogleBusy} onComplete={() => setVerifiedUntil(Date.now() + 4 * 60 * 1000)} unavailableMessage="Google confirmation is unavailable. Check your connection and retry, or choose Budgetly password if you have one."/>}
      </> : <>
        <label className="field"><span>Confirm password to register a passkey</span><PasswordInput autoComplete="current-password" value={password} onChange={event => onPassword(event.target.value)}/></label>
        {password.length < 8 && <small className="muted">Enter your Budgetly password above to enable registration.</small>}
      </>}
      <button type="button" className="button primary" disabled={!supported || blocked || (method === 'google' ? !verifiedUntil : password.length < 8)} onClick={register}><Fingerprint/>{busy ? 'Registering…' : enabled ? 'Register another passkey' : 'Enable biometric sign-in'}</button>
      {method === 'google' && !verifiedUntil && <small className="muted">Confirm your Google account to enable registration.</small>}
      {registrationError && <p className="form-error" role="alert">{registrationError}</p>}
      {!supported && <small className="muted">Passkeys require a supported browser with HTTPS, or a supported Android device with a screen lock.</small>}
    </>}
    {busy && <p role="status">Registering your device passkey…</p>}
    {enabled && <button type="button" className="button ghost" disabled={blocked} onClick={onDisable}>Revoke all passkeys</button>}
  </div>
}
