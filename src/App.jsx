import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, RefreshCw, Sparkles } from 'lucide-react'
import { api, auth, flushOfflineTransactions, jsonBody } from './lib/api'
import { rememberOfflineSession, restoreOfflineSession, setOfflineUser } from './lib/offlineSync'
import AppShell from './components/AppShell'
const Overview = lazy(() => import('./pages/Overview'))
const AskAI = lazy(() => import('./pages/AskAI'))
const Transactions = lazy(() => import('./pages/Transactions'))
const SharedTransactions = lazy(() => import('./pages/SharedTransactions'))
const CalendarPage = lazy(() => import('./pages/CalendarPage'))
const Analytics = lazy(() => import('./pages/Analytics'))
const Budgets = lazy(() => import('./pages/Budgets'))
const GoalsDebts = lazy(() => import('./pages/GoalsDebts'))
const Wallets = lazy(() => import('./pages/Wallets'))
const Settings = lazy(() => import('./pages/Settings'))
const Admin = lazy(() => import('./pages/Admin'))
const Notes = lazy(() => import('./pages/Notes'))
const Feedback = lazy(() => import('./pages/Feedback'))
const Upcoming = lazy(() => import('./pages/Upcoming'))
const Attention = lazy(() => import('./pages/Attention'))
const BankMessages = lazy(() => import('./pages/BankMessages'))
import BrandLogo from './components/BrandLogo'
import BrandFooter from './components/BrandFooter'
import PasswordInput from './components/PasswordInput'
import { useConfirmation } from './components/Confirmation'
import Experience from './components/Experience'
import { biometricSupported, unlockBiometric, cancelBiometric } from './lib/biometric'
import DeviceSignInPreference from './components/DeviceSignInPreference'
import PasswordRecovery from './components/PasswordRecovery'
import GoogleSignIn from './components/GoogleSignIn'
import { cancelReminder } from './lib/deviceNotifications'
import { BankSms, smsAvailable } from './lib/bankSms'
import { readDeviceAppearance, useAppearance } from './lib/appearance'
import AndroidUpdate from './components/AndroidUpdate'
import FeedbackPrompt from './components/FeedbackPrompt'
import { syncPlannedNotifications, cancelPlannedNotifications } from './lib/plannedNotifications'
import { notificationSettingsChangedEvent } from './lib/notificationSettings'
import { guestActive, guestRemembered, guestUser, guestHasRecords, guestRoutes, readGuest, setGuestActive, requestGuestSignIn } from './lib/guest'
import GuestAccess, { GuestGate } from './components/GuestAccess'
import GuestImport from './components/GuestImport'
const GuestSettings = lazy(() => import('./pages/GuestSettings'))

const AppContext = createContext(null)
export const useApp = () => useContext(AppContext)

export function LoginScreen({ onLogin, onGuest, returningGuest = false }) {
  const [enteringGuest, setEnteringGuest] = useState(false)
  useEffect(() => {
    if (!enteringGuest) return
    const timer = window.setTimeout(() => { Promise.resolve(onGuest()).catch(error => { setError(error.message); setEnteringGuest(false) }) }, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 10 : 480)
    return () => window.clearTimeout(timer)
  }, [enteringGuest, onGuest])
  useEffect(() => () => cancelBiometric(), [])
  const [, refreshSignInPreference] = useState(0)
  const [rememberMe, setRememberMe] = useState(() => auth.remembered)
  const [mode, setMode] = useState(()=>new URLSearchParams(location.search).has('reset')?'reset':'login')
  const [signInMethod, setSignInMethod] = useState('password')
  const finishLogin = async result => {
    auth.setRemembered(rememberMe)
    auth.token = result.token
    await onLogin(result.user)
  }
  const passkeyLogin = async () => {
    if(busy||googleBusy)return
    setBusy(true); setError('')
    try { const result = await unlockBiometric(); await finishLogin(result) }
    catch (err) { setError(['NotAllowedError', 'AbortError'].includes(err.name) ? 'Passkey cancelled or unavailable. You can use your password.' : err.message) }
    finally { setBusy(false) }
  }
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [signup, setSignup] = useState({ username: '', email: '', password: '', phone: '' })
  const [challenge, setChallenge] = useState('')
  const [verificationEmail, setVerificationEmail] = useState('')
  const [code, setCode] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [googleBusy,setGoogleBusy] = useState(false)
  const [googleActive,setGoogleActive] = useState(false)
  const [retryAfter, setRetryAfter] = useState(0)

  useEffect(() => {
    if (!retryAfter) return undefined
    const timer = window.setInterval(() => setRetryAfter(v => Math.max(0, v - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [retryAfter])

  const login = async e => {
    e.preventDefault()
    if(busy||googleBusy)return
    setBusy(true); setError('')
    try {
      const result = await api('/api/auth/login', { method: 'POST', ...jsonBody({ email, password }) })
      await finishLogin(result)
    } catch (err) { setError(err.message); setPassword('') }
    finally { setBusy(false) }
  }

  const requestCode = async e => {
    e?.preventDefault()
    if(busy||googleBusy)return
    setBusy(true); setError(''); setMessage('')
    try {
      const result = await api('/api/auth/signup/start', { method: 'POST', ...jsonBody(signup) })
      setChallenge(result.challenge)
      setVerificationEmail(result.email)
      setRetryAfter(Number(result.retry_after || 45))
      setMessage(result.message || 'Verification code sent.')
      setCode('')
      setMode('verify')
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  const verify = async e => {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      const result = await api('/api/auth/signup/verify', { method: 'POST', ...jsonBody({ challenge, code }) })
      await finishLogin(result)
    } catch (err) { setError(err.message); setCode('') }
    finally { setBusy(false) }
  }

  const authOptions = <div className="auth-options"><label className="check-row remember-session"><input type="checkbox" checked={rememberMe} disabled={busy||googleBusy} onChange={e => { try { auth.setRemembered(e.target.checked); setRememberMe(e.target.checked); setError('') } catch (err) { setError(err.message) } }}/><span>Keep me signed in on this device</span></label><button type="button" className="auth-switch" onClick={()=>setMode('reset')}>Forgot password?</button></div>

  return <div className={`auth-screen expanded-auth${enteringGuest ? ' guest-entering' : ''}`} onInvalid={e => setError(e.target.validationMessage)}>
    <header className="auth-brand"><BrandLogo /><span><strong>Budgetly</strong><small>Personal finance</small></span></header>
    <div className="auth-layout">
      <section className="auth-copy" aria-label="Budgetly">
        <p className="eyebrow">Your money, in view</p>
        <h1>{mode === 'login' ? 'Sign in to Budgetly' : mode === 'signup' ? 'Create your Budgetly account' : mode === 'verify' ? 'Almost there' : 'Return to Budgetly'}</h1>
        <p>A clearer view of everyday spending, shared plans, and what comes next.</p>
      </section>
      <motion.main key={mode} className="auth-main" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{duration:.38,ease:[.22,1,.36,1]}}>
      {mode === 'reset' && <PasswordRecovery onBack={()=>setMode('login')}/>}

      {!googleActive && ['login','signup'].includes(mode) && <div className="segment-control signin-method" role="group" aria-label="Sign-in method">
        <button type="button" aria-pressed={signInMethod === 'password'} disabled={busy || googleBusy || enteringGuest} className={signInMethod === 'password' ? 'active' : ''} onClick={() => { setSignInMethod('password'); setError('') }}>Password</button>
        <button type="button" aria-pressed={signInMethod === 'passkey'} disabled={busy || googleBusy || enteringGuest || !biometricSupported()} className={signInMethod === 'passkey' ? 'active' : ''} onClick={() => { setSignInMethod('passkey'); setMode('login'); setError('') }}>Passkey</button>
        {onGuest && <button type="button" aria-pressed={signInMethod === 'guest'} disabled={busy || googleBusy || enteringGuest} className={signInMethod === 'guest' ? 'active' : ''} onClick={() => { setSignInMethod('guest'); setError('') }}>Guest</button>}
      </div>}
      {signInMethod === 'guest' && ['login','signup'].includes(mode) && <section className="auth-guest" aria-label="Guest access">
        <h2>{returningGuest ? 'Your guest workspace' : 'Try Budgetly'}</h2>
        <p className="auth-intro">Guest records stay on this device. Clearing storage or uninstalling can remove them.</p>
        {error && <div className="form-error" role="alert">{error}</div>}
        <button type="button" className="button primary" disabled={enteringGuest} onClick={() => setEnteringGuest(true)}>{enteringGuest ? 'Opening...' : 'Continue'}</button>
      </section>}
      {mode === 'login' && signInMethod !== 'guest' && <>
        <h2>Welcome back</h2>
        {!googleActive && <>
        <p className="auth-intro">Sign in to continue to your finances.</p>
        {signInMethod === 'passkey' ? <div className="auth-passkey"><p className="auth-intro">Use the passkey saved to your device to sign in securely.</p>{error && <div className="form-error" role="alert">{error}</div>}{authOptions}<button className="button primary" disabled={busy||googleBusy} onClick={passkeyLogin}>{busy ? 'Verifying...' : 'Sign in with passkey'}</button></div> : <form onSubmit={login} className="auth-form">
          <label className="auth-entry"><span>Email</span><input required type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email address" /></label>
          <div className="auth-entry"><label htmlFor="login-password">Password</label><PasswordInput id="login-password" required minLength="8" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" /></div>
          {error && <div className="form-error">{error}</div>}
          {authOptions}
          <div className="auth-action-row"><button className="button primary" disabled={busy||googleBusy}>{busy ? 'Signing in…' : 'Sign in'}</button></div>
        </form>}
        </>}
        <GoogleSignIn onLogin={finishLogin} disabled={busy} onBusyChange={setGoogleBusy} onActiveChange={setGoogleActive}/>
        {!googleActive && <DeviceSignInPreference disabled={busy||googleBusy} onChange={() => { setSignInMethod('password'); setError(''); refreshSignInPreference(v => v + 1) }}/>}
      </>}

      {mode === 'signup' && signInMethod !== 'guest' && <>
        <h2>Create account</h2>
        <GoogleSignIn onLogin={finishLogin} disabled={busy} onBusyChange={setGoogleBusy} onActiveChange={setGoogleActive}/>
        {!googleActive && <>
        <p className="auth-intro">One place for your personal and shared finances.</p>
        <form onSubmit={requestCode} className="auth-form">
          <label className="auth-entry"><span>Username</span><input required autoComplete="name" value={signup.username} onChange={e => setSignup({ ...signup, username: e.target.value })} placeholder="Your name" minLength="2" maxLength="80" /></label>
          <label className="auth-entry"><span>Email</span><input required type="email" autoComplete="email" value={signup.email} onChange={e => setSignup({ ...signup, email: e.target.value })} placeholder="you@example.com" /></label>
          <div className="auth-entry"><label htmlFor="signup-password">Password</label><PasswordInput id="signup-password" required autoComplete="new-password" value={signup.password} onChange={e => setSignup({ ...signup, password: e.target.value })} placeholder="At least 8 characters" minLength="8" maxLength="128" /></div>
          {error && <div className="form-error">{error}</div>}
          <div className="auth-action-row"><button className="button primary" disabled={busy||googleBusy}>{busy ? 'Sending code…' : 'Continue to email verification'}</button></div>
        </form>
        </>}
      </>}

      {mode === 'verify' && <>
        <h2>Enter the 6-digit code</h2>
        <p className="auth-intro">Sent to <strong>{verificationEmail}</strong>. The code expires in 10 minutes.</p>
        <form onSubmit={verify} className="auth-form">
          <label className="auth-entry auth-code"><span>Verification code</span><input autoFocus inputMode="numeric" autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" /></label>
          {message && !error && <div className="form-note">{message}</div>}
          {error && <div className="form-error">{error}</div>}
          <div className="auth-action-row"><button className="button primary" disabled={busy || code.length !== 6}>{busy ? 'Verifying…' : 'Verify & sign in'}</button></div>
        </form>
        <div className="auth-secondary-actions">
          <button type="button" onClick={() => { setError(''); setMessage(''); setMode('signup') }}><ArrowLeft size={14}/>Start over</button>
          <button type="button" disabled={busy || retryAfter > 0} onClick={() => requestCode()}><RefreshCw size={14}/>{retryAfter > 0 ? `Resend in ${retryAfter}s` : 'Resend code'}</button>
        </div>
      </>}
        {!googleActive && signInMethod !== 'guest' && mode === 'login' && <div className="auth-footer-action">New to Budgetly? <button className="auth-switch" type="button" onClick={() => { setError(''); setMode('signup'); setSignInMethod('password') }}>Create an account</button></div>}
        {!googleActive && signInMethod !== 'guest' && mode === 'signup' && <div className="auth-footer-action">Already have an account? <button className="auth-switch" type="button" onClick={() => { setError(''); setMode('login'); setSignInMethod('password') }}>Sign in</button></div>}
      </motion.main>
    </div>
    <footer className="auth-footer"><BrandFooter/></footer>
  </div>
}

export default function App() {
  const currentLocation = useLocation()
  const { confirm, confirmation } = useConfirmation()
  const [session, setSession] = useState({ loading: true, user: null })
  const [settings, setSettings] = useState(() => ({ ...readDeviceAppearance(), currency: 'KWD', display_name: 'Budgetly', week_starts_on: 'sunday', compact_numbers: false }))
  useAppearance(settings)
  const [appearance, setAppearance] = useState({ profile_image: '', wallpaper_image: '' })
  const [refreshKey, setRefreshKey] = useState(0)
  const [toast, setToast] = useState(null)
  const [signoutRequested, setSignoutRequested] = useState(false)
  const [guestFeature, setGuestFeature] = useState('')
  const [guestSigningIn, setGuestSigningIn] = useState(false)
  const [importGuest, setImportGuest] = useState(false)
  const isGuest = session.user?.role === 'guest'
  const enterGuest = useCallback(async () => {
    const data = readGuest()
    setGuestActive(true); setOfflineUser(null)
    setSettings(data.settings); setAppearance({ profile_image: '', wallpaper_image: '' })
    setGuestSigningIn(false); setSession({ loading: false, user: guestUser })
  }, [])
  const requestSignIn = useCallback(feature => requestGuestSignIn(feature), [])
  useEffect(() => {
    const review = () => { if (session.user && !isGuest) { try { setImportGuest(guestHasRecords()) } catch (error) { console.error(error) } } }
    window.addEventListener('budgetly:guest-import', review)
    return () => window.removeEventListener('budgetly:guest-import', review)
  }, [session.user, isGuest])

  const notify = useCallback((message, type = 'success', action = null) => {
    setToast({ id: Date.now(), message, type, action })
  }, [])
  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(null), toast.action ? 15000 : 5000)
    return () => window.clearTimeout(timer)
  }, [toast])
  const refresh = useCallback(() => setRefreshKey(v => v + 1), [])
  useEffect(() => {
    const prompt = event => { if (guestActive()) setGuestFeature(event.detail || 'this feature') }
    const changed = () => { if (guestActive()) refresh() }
    const storage = event => { if (event.key === 'budgetly_guest_workspace_v1' && guestActive()) { try { setSettings(readGuest().settings); refresh() } catch (error) { notify(error.message, 'error') } } }
    window.addEventListener('budgetly:guest-signin', prompt)
    window.addEventListener('budgetly:guest-changed', changed)
    window.addEventListener('storage', storage)
    return () => { window.removeEventListener('budgetly:guest-signin', prompt); window.removeEventListener('budgetly:guest-changed', changed); window.removeEventListener('storage', storage) }
  }, [refresh, notify])
  useEffect(() => {
    if (!session.user || isGuest) return undefined
    const sync = () => { if (document.visibilityState !== 'hidden') void flushOfflineTransactions().catch(console.error) }
    const changed = () => refresh()
    sync()
    const timer = window.setInterval(sync, 30000)
    window.addEventListener('online', sync)
    window.addEventListener('focus', sync)
    window.addEventListener('visibilitychange', sync)
    window.addEventListener('budgetly:offline-synced', changed)
    return () => { window.clearInterval(timer); window.removeEventListener('online', sync); window.removeEventListener('focus', sync); window.removeEventListener('visibilitychange', sync); window.removeEventListener('budgetly:offline-synced', changed) }
  }, [session.user?.id, refresh])
  useEffect(() => { if (session.user && auth.token) void rememberOfflineSession(session.user, settings, auth.token) }, [session.user, settings])
  useEffect(() => {
    if (!session.user || isGuest) return undefined
    const sync = () => { if (document.visibilityState !== 'hidden') void syncPlannedNotifications(session.user.id).catch(console.error) }
    sync()
    const timer = window.setInterval(sync, 60000)
    window.addEventListener('focus',sync)
    window.addEventListener(notificationSettingsChangedEvent,sync)
    return () => {window.clearInterval(timer);window.removeEventListener('focus',sync);window.removeEventListener(notificationSettingsChangedEvent,sync)}
  }, [session.user?.id, refreshKey])

  const loadSettings = useCallback(async () => {
    try { setSettings(await api('/api/settings')); return true } catch (err) {
      if (err.status === 401) auth.clear()
      else console.error(err)
      return false
    }
  }, [])

  const loadAppearance = useCallback(async () => {
    try { setAppearance(await api('/api/account/appearance')); return true } catch (err) {
      if (err.status !== 401) console.error(err)
      return false
    }
  }, [])

  useEffect(() => {
    const wallpaperStyle = settings.wallpaper_enabled === false ? 'none' : settings.wallpaper_style || (appearance.wallpaper_image ? 'custom' : 'none')
    const wallpaper = wallpaperStyle === 'custom' ? appearance.wallpaper_image || '' : ''
    document.body.style.backgroundImage = wallpaper ? `url(${JSON.stringify(wallpaper)})` : ''
    document.body.style.backgroundSize = wallpaper ? 'cover' : ''
    document.body.style.backgroundPosition = wallpaper ? 'center' : ''
    document.body.style.backgroundAttachment = wallpaper ? 'fixed' : ''
    document.body.classList.toggle('has-wallpaper', Boolean(wallpaper))
    document.body.classList.toggle('wallpaper-budgetly', wallpaperStyle === 'budgetly')
    return () => {
      document.body.style.backgroundImage = ''
      document.body.style.backgroundSize = ''
      document.body.style.backgroundPosition = ''
      document.body.style.backgroundAttachment = ''
      document.body.classList.remove('has-wallpaper')
      document.body.classList.remove('wallpaper-budgetly')
    }
  }, [appearance.wallpaper_image, settings.wallpaper_enabled, settings.wallpaper_style])

  useEffect(() => {
    const resume = async () => {
      if (!auth.token) { if (guestRemembered()) { try { await enterGuest(); return } catch (error) { console.error(error) } } setSession({ loading: false, user: null }); return }
      setGuestActive(false)
      api('/api/auth/me').then(async user => {
      setOfflineUser(user.id)
      await loadSettings()
      if (!auth.token) { setSession({ loading: false, user: null }); return }
      setSession({ loading: false, user })
      void loadAppearance()
      }).catch(async error => {
        const temporaryOutage = error.network || [502, 503, 504].includes(error.status)
        const saved = temporaryOutage ? await restoreOfflineSession(auth.token) : null
        if (saved) { setOfflineUser(saved.user.id); setSettings(saved.settings); setSession({ loading: false, user: saved.user }); return }
        if (!temporaryOutage) { auth.clear(); localStorage.removeItem('flowbudget_biometric_session') }
        setSession({ loading: false, user: null })
      })
    }
    void resume()
  }, [loadSettings, loadAppearance, enterGuest])

  const finishSignOut = useCallback(() => {
    void api('/api/account/signout',{method:'POST'}).catch(()=>{})
    if (smsAvailable()) void BankSms.configure({enabled:false}).catch(console.error)
    void cancelReminder().catch(console.error)
    void cancelPlannedNotifications().catch(console.error)
    auth.clear()
    setAppearance({ profile_image: '', wallpaper_image: '' })
    setSession({ loading: false, user: null })
    setSignoutRequested(false)
  }, [])
  const signOut = useCallback(() => setSignoutRequested(true), [])

  const completeLogin = useCallback(async user => {
    setGuestActive(false); setGuestSigningIn(false)
    setOfflineUser(user.id)
    await loadSettings()
    setSession({ loading: false, user })
    void loadAppearance()
    try { setImportGuest(guestHasRecords()) } catch (error) { notify(error.message, 'error') }
  }, [loadSettings, loadAppearance, notify])

  const reloadUser = useCallback(async () => {
    const user = await api('/api/auth/me')
    setSession({loading:false,user})
  }, [])

  const value = useMemo(() => ({
    user: session.user, settings, setSettings, appearance, setAppearance,
    refreshKey, refresh, notify, confirm, reloadSettings: loadSettings, reloadAppearance: loadAppearance, reloadUser, isGuest, requestSignIn, lock: isGuest ? () => setGuestSigningIn(true) : signOut,
  }), [session.user, settings, appearance, refreshKey, refresh, notify, confirm, loadSettings, loadAppearance, reloadUser, signOut, isGuest, requestSignIn])

  if (session.loading) return <div className="app-loading"><BrandLogo className="pulse" /></div>
  if (!session.user || guestSigningIn) return <><LoginScreen onLogin={completeLogin} onGuest={enterGuest} returningGuest={isGuest}/><AndroidUpdate authentication/></>

  return <AppContext.Provider value={value}>
    {!isGuest && <Experience />}
    <div className="ambient" aria-hidden="true"><i/><i/><i/></div>
    <AppShell>
      <Suspense fallback={<div role="status">Loading page...</div>}>
      {isGuest && !guestRoutes.has(currentLocation.pathname) ? <GuestGate/> : <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/ask-ai" element={<AskAI />} />
        <Route path="/transactions" element={<Transactions />} />
        <Route path="/upcoming" element={<Upcoming />} />
        <Route path="/attention" element={<Attention />} />
        <Route path="/shared-transactions" element={<SharedTransactions />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/budgets" element={<Budgets />} />
        <Route path="/goals" element={<GoalsDebts />} />
        <Route path="/wallets" element={<Wallets />} />
        <Route path="/notes" element={<Notes />} />
        <Route path="/feedback" element={<Feedback />} />
        <Route path="/settings" element={isGuest ? <GuestSettings /> : <Settings />} />
        <Route path="/bank-messages" element={<BankMessages />} />
        <Route path="/admin" element={session.user?.role === 'admin' ? <Admin /> : <Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>}
      </Suspense>
    </AppShell>
    {!isGuest && <FeedbackPrompt signoutRequested={signoutRequested} onSignoutComplete={finishSignOut}/>}
    <GuestAccess feature={guestFeature} onClose={() => setGuestFeature('')} onContinue={() => { setGuestFeature(''); setGuestSigningIn(true) }}/>
    {importGuest && !isGuest && <GuestImport user={session.user} onDone={message => {setImportGuest(false);refresh();if(message)notify(message)}}/>}
    {confirmation}
    <AnimatePresence>{toast && <motion.div role={toast.type === 'error' ? 'alert' : 'status'} className={`toast ${toast.type}`} initial={{ opacity: 0, y: -18, scale: .96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -12 }}>{toast.message}{toast.action && <button className="toast-action" onClick={() => {const action=toast.action;setToast(null);void action.run().catch(err=>notify(err.message,'error'))}}>{toast.action.label}</button>}</motion.div>}</AnimatePresence>
  </AppContext.Provider>
}
