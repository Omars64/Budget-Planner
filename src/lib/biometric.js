import { api, jsonBody } from './api'
import { Capacitor } from '@capacitor/core'

// Remove the legacy session-token cache; passkeys now issue fresh server sessions.
try { localStorage.removeItem('flowbudget_biometric_session'); localStorage.removeItem('flowbudget_biometric_credential') } catch { /* Storage may be disabled. */ }
const encode = value => btoa(String.fromCharCode(...new Uint8Array(value))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const decode = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4-value.length%4)%4)), c => c.charCodeAt(0))
const passwordOnlyKey = 'flowbudget_password_only'
export const passwordOnlyEnabled = () => {
  try { return localStorage.getItem(passwordOnlyKey) === 'true' } catch { return false }
}
export function setPasswordOnly(enabled) {
  localStorage.setItem(passwordOnlyKey, String(enabled))
  if (enabled) cancelBiometric()
}
export const biometricSupported = () => !passwordOnlyEnabled() && !Capacitor.isNativePlatform() && window.top === window.self && window.isSecureContext && !!window.PublicKeyCredential && !!navigator.credentials
let activeRequest = null
export const cancelBiometric = () => activeRequest?.abort()

async function withCredentialRequest(action) {
  if (!biometricSupported()) throw new Error('Passkeys are unavailable on this device. Use your password.')
  if (document.visibilityState === 'hidden') throw new Error('Open FlowBudget before using your passkey.')
  if (activeRequest) throw new Error('A passkey request is already in progress.')
  const controller = new AbortController()
  activeRequest = controller
  const cancel = () => controller.abort()
  window.addEventListener('pagehide', cancel)
  const timeout = setTimeout(cancel, 120000)
  try { return await action(controller.signal) }
  catch (error) { controller.signal.throwIfAborted(); throw error }
  finally {
    clearTimeout(timeout)
    window.removeEventListener('pagehide', cancel)
    if (activeRequest === controller) activeRequest = null
  }
}
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
  return withCredentialRequest(async signal => {
  const request = await api('/api/passkeys/register/options', { method:'POST', signal, ...jsonBody({password}) })
  signal.throwIfAborted()
  const options = request.options
  options.challenge = decode(options.challenge)
  options.user.id = decode(options.user.id)
  options.excludeCredentials = (options.excludeCredentials || []).map(c => ({...c, id:decode(c.id)}))
  const credential = await navigator.credentials.create({publicKey:options, signal})
  signal.throwIfAborted()
  if (!credential) throw new Error('Passkey setup cancelled.')
  return api('/api/passkeys/register/verify', {method:'POST', signal, ...jsonBody({challenge_id:request.challenge_id, credential:serialize(credential)})})
  })
}
export async function unlockBiometric() {
  return withCredentialRequest(async signal => {
  const request = await api('/api/passkeys/login/options', {method:'POST', signal})
  signal.throwIfAborted()
  const options = {...request.options, challenge:decode(request.options.challenge)}
  if (options.allowCredentials) options.allowCredentials = options.allowCredentials.map(c => ({...c, id:decode(c.id)}))
  const credential = await navigator.credentials.get({publicKey:options, signal})
  signal.throwIfAborted()
  if (!credential) throw new Error('Passkey sign-in cancelled.')
  const result = await api('/api/passkeys/login/verify', {method:'POST', signal, ...jsonBody({challenge_id:request.challenge_id, credential:serialize(credential)})})
  signal.throwIfAborted()
  return result
  })
}
export const disableBiometric = () => api('/api/passkeys', {method:'DELETE'})
