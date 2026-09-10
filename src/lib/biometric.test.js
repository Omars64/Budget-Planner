import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { biometricSupported, cancelBiometric, passwordOnlyEnabled, setPasswordOnly, setupBiometric, unlockBiometric } from './biometric'
import { api } from './api'
const native = vi.hoisted(() => ({enabled:false, status:vi.fn(), create:vi.fn(), get:vi.fn(), cancel:vi.fn()}))

vi.mock('./api', () => ({ api: vi.fn(), jsonBody: value => ({body:JSON.stringify(value)}) }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => native.enabled, getPlatform: () => 'android', isPluginAvailable: () => true }, registerPlugin: () => native }))

beforeEach(() => {
  localStorage.clear()
  native.enabled = false
  for (const key of ['status', 'create', 'get', 'cancel']) native[key].mockReset()
  native.status.mockResolvedValue({supported:true,screenLock:true})
  native.cancel.mockResolvedValue({})
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal('PublicKeyCredential', class {})
  Object.defineProperty(navigator, 'credentials', {configurable:true, value:{create:vi.fn(), get:vi.fn()}})
  vi.mocked(api).mockReset()
  vi.mocked(api).mockResolvedValue({challenge_id:'one', options:{challenge:'dGVzdA', user:{id:'dGVzdA'}, excludeCredentials:[]}})
})
afterEach(() => { cancelBiometric(); vi.unstubAllGlobals() })

it('password-only mode persists without deleting account passkeys or invoking any credential API', async () => {
  setPasswordOnly(true)
  expect(passwordOnlyEnabled()).toBe(true)
  expect(biometricSupported()).toBe(false)
  await expect(setupBiometric('test@example.com', 'secret')).rejects.toThrow('Use your password')
  await expect(unlockBiometric()).rejects.toThrow('Use your password')
  expect(api).not.toHaveBeenCalled()
  expect(navigator.credentials.create).not.toHaveBeenCalled()
  expect(navigator.credentials.get).not.toHaveBeenCalled()
  setPasswordOnly(false)
  expect(biometricSupported()).toBe(true)
})

it('does not start an authenticator from a hidden page', async () => {
  const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  await expect(unlockBiometric()).rejects.toThrow('Open FlowBudget')
  expect(api).not.toHaveBeenCalled()
  hidden.mockRestore()
})

it('permits only one explicit prompt and cancels it on page exit', async () => {
  let signal
  navigator.credentials.get.mockImplementation(options => {
    signal = options.signal
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), {once:true}))
  })
  const first = unlockBiometric()
  const cancelled = expect(first).rejects.toMatchObject({name:'AbortError'})
  await vi.waitFor(() => expect(navigator.credentials.get).toHaveBeenCalledTimes(1))
  await expect(unlockBiometric()).rejects.toThrow('already in progress')
  window.dispatchEvent(new Event('pagehide'))
  await cancelled
  expect(signal.aborted).toBe(true)
  expect(api).toHaveBeenCalledTimes(1)
})

it('aborts before opening the authenticator if the user leaves during option loading', async () => {
  let complete
  vi.mocked(api).mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
  const request = setupBiometric('test@example.com', 'secret')
  const cancelled = expect(request).rejects.toMatchObject({name:'AbortError'})
  window.dispatchEvent(new Event('pagehide'))
  complete({options:{}})
  await cancelled
  expect(navigator.credentials.create).not.toHaveBeenCalled()
})

it('finishes a user-initiated enrollment without requesting device permissions', async () => {
  const rawId = new Uint8Array([1,2,3]).buffer
  navigator.credentials.create.mockResolvedValue({id:'AQID', rawId, type:'public-key', response:{clientDataJSON:rawId,attestationObject:rawId}, getClientExtensionResults:() => ({})})
  vi.mocked(api).mockResolvedValueOnce({challenge_id:'one',options:{challenge:'dGVzdA',user:{id:'dGVzdA'},excludeCredentials:[]}}).mockResolvedValueOnce({enabled:true})
  await expect(setupBiometric('test@example.com','secret')).resolves.toEqual({enabled:true})
  const verification = JSON.parse(api.mock.calls[1][1].body)
  expect(verification.credential.rawId).toBe('AQID')
  expect(navigator.credentials.create.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal)
})

it('uses Android Credential Manager and sends its unchanged credential to the server', async () => {
  native.enabled = true
  const credential = {id:'AQID',rawId:'AQID',type:'public-key',response:{clientDataJSON:'dGVzdA'}}
  native.create.mockResolvedValue({credential})
  api.mockResolvedValueOnce({challenge_id:'native',options:{challenge:'dGVzdA',rp:{id:'budget-planner-ecru-seven.vercel.app'}}}).mockResolvedValueOnce({enabled:true})
  await expect(setupBiometric('test@example.com','secret')).resolves.toEqual({enabled:true})
  expect(native.create).toHaveBeenCalledOnce()
  expect(JSON.parse(api.mock.calls[1][1].body)).toEqual({challenge_id:'native',credential})
  expect(navigator.credentials.create).not.toHaveBeenCalled()
})

it('requires server verification before native sign-in returns a session', async () => {
  native.enabled = true
  native.get.mockResolvedValue({credential:{id:'AQID'}})
  api.mockResolvedValueOnce({challenge_id:'native',options:{challenge:'dGVzdA'}}).mockRejectedValueOnce(new Error('Passkey verification failed'))
  await expect(unlockBiometric()).rejects.toThrow('verification failed')
  expect(navigator.credentials.get).not.toHaveBeenCalled()
})

it('gives Android screen-lock setup guidance before opening the provider', async () => {
  native.enabled = true
  native.status.mockResolvedValue({supported:true,screenLock:false})
  await expect(unlockBiometric()).rejects.toThrow('Android Settings > Security')
  expect(native.get).not.toHaveBeenCalled()
})

it('does not invoke native passkeys in password-only mode', async () => {
  native.enabled = true
  setPasswordOnly(true)
  await expect(unlockBiometric()).rejects.toThrow('Use your password')
  expect(native.status).not.toHaveBeenCalled()
})
