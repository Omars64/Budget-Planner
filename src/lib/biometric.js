import { api, jsonBody } from './api'
import { Capacitor } from '@capacitor/core'

// Remove the legacy session-token cache; passkeys now issue fresh server sessions.
try { localStorage.removeItem('flowbudget_biometric_session'); localStorage.removeItem('flowbudget_biometric_credential') } catch { /* Storage may be disabled. */ }
const encode = value => btoa(String.fromCharCode(...new Uint8Array(value))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const decode = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4-value.length%4)%4)), c => c.charCodeAt(0))
export const biometricSupported = () => !Capacitor.isNativePlatform() && window.isSecureContext && !!window.PublicKeyCredential && !!navigator.credentials
function serialize(c) {
  const response = { clientDataJSON: encode(c.response.clientDataJSON) }
  for (const key of ['attestationObject', 'authenticatorData', 'signature', 'userHandle']) {
    if (c.response[key]) response[key] = encode(c.response[key])
  }
  if (c.response.getTransports) response.transports = c.response.getTransports()
  // rawId is the stable binary credential identifier; keep id for WebAuthn compatibility.
  const rawId = encode(c.rawId)
  return { id: rawId, rawId, type: c.type, response, clientExtensionResults: c.getClientExtensionResults() }
}
export async function setupBiometric(email, password) {
  if (!biometricSupported()) throw new Error('Passkeys require a supported browser and HTTPS.')
  const request = await api('/api/passkeys/register/options', { method:'POST', ...jsonBody({password}) })
  const options = request.options
  options.challenge = decode(options.challenge)
  options.user.id = decode(options.user.id)
  options.excludeCredentials = (options.excludeCredentials || []).map(c => ({...c, id:decode(c.id)}))
  const credential = await navigator.credentials.create({publicKey:options})
  if (!credential) throw new Error('Passkey setup cancelled.')
  return api('/api/passkeys/register/verify', {method:'POST', ...jsonBody({challenge_id:request.challenge_id, credential:serialize(credential)})})
}
export async function unlockBiometric() {
  if (!biometricSupported()) throw new Error('Passkeys are unavailable. Use your password.')
  const request = await api('/api/passkeys/login/options', {method:'POST'})
  const options = {...request.options, challenge:decode(request.options.challenge)}
  const credential = await navigator.credentials.get({publicKey:options})
  if (!credential) throw new Error('Passkey sign-in cancelled.')
  return api('/api/passkeys/login/verify', {method:'POST', ...jsonBody({challenge_id:request.challenge_id, credential:serialize(credential)})})
}
export const disableBiometric = () => api('/api/passkeys', {method:'DELETE'})
