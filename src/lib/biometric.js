const credentialKey = 'flowbudget_biometric_credential'
const tokenKey = 'flowbudget_biometric_session'
const encode = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const decode = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)), char => char.charCodeAt(0))
export const biometricSupported = () => typeof window !== 'undefined' && !!window.PublicKeyCredential && !!navigator.credentials
export const biometricEnabled = () => Boolean(localStorage.getItem(credentialKey) && localStorage.getItem(tokenKey))
export async function setupBiometric(email, token) {
  if (!biometricSupported()) throw new Error('Biometric sign-in is not supported by this browser or device.')
  const credential = await navigator.credentials.create({ publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), rp: { name: 'FlowBudget' }, user: { id: crypto.getRandomValues(new Uint8Array(16)), name: email, displayName: email }, pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }], authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' }, timeout: 60000 } })
  if (!credential) throw new Error('Biometric setup was cancelled.')
  localStorage.setItem(credentialKey, encode(credential.rawId)); localStorage.setItem(tokenKey, token)
}
export async function unlockBiometric() {
  const id = localStorage.getItem(credentialKey); const token = localStorage.getItem(tokenKey)
  if (!id || !token || !biometricSupported()) return ''
  try { const result = await navigator.credentials.get({ publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), allowCredentials: [{ id: decode(id), type: 'public-key' }], userVerification: 'required', timeout: 60000 } }); return result ? token : '' } catch { return '' }
}
export const disableBiometric = () => { localStorage.removeItem(credentialKey); localStorage.removeItem(tokenKey) }
