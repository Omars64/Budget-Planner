import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, RefreshCw, Sparkles } from 'lucide-react'
import { api, auth, jsonBody } from './lib/api'
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
import { cancelReminder } from './lib/deviceNotifications'
import { BankSms, smsAvailable } from './lib/bankSms'
import { readDeviceAppearance, useAppearance } from './lib/appearance'
import FeedbackPrompt from './components/FeedbackPrompt'
import { syncPlannedNotifications, cancelPlannedNotifications } from './lib/plannedNotifications'
import { notificationSettingsChangedEvent } from './lib/notificationSettings'

const AppContext = createContext(null)
export const useApp = () => useContext(AppContext)

export function LoginScreen({ onLogin }) {
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
  const [retryAfter, setRetryAfter] = useState(0)

  useEffect(() => {
    if (!retryAfter) return undefined
    const timer = window.setInterval(() => setRetryAfter(v => Math.max(0, v - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [retryAfter])

  const login = async e => {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      const result = await api('/api/auth/login', { method: 'POST', ...jsonBody({ email, password }) })
      await finishLogin(result)
    } catch (err) { setError(err.message); setPassword('') }
    finally { setBusy(false) }
  }

  const requestCode = async e => {
    e?.preventDefault()
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

  const authOptions = <div className="auth-options"><label className="check-row remember-session"><input type="checkbox" checked={rememberMe} disabled={busy} onChange={e => { try { auth.setRemembered(e.target.checked); setRememberMe(e.target.checked); setError('') } catch (err) { setError(err.message) } }}/><span>Keep me signed in on this device</span></label><button type="button" className="auth-switch" onClick={()=>setMode('reset')}>Forgot password?</button></div>

  return <div className="auth-screen expanded-auth" onInvalid={e => setError(e.target.validationMessage)}>
    <header className="auth-brand"><BrandLogo /><span><strong>Budgetly</strong><small>Personal finance</small></span></header>
    <div className="auth-layout">
      <section className="auth-copy" aria-label="Budgetly">
        <p className="eyebrow">Your money, in view</p>
        <h1>{mode === 'login' ? 'Sign in to Budgetly' : mode === 'signup' ? 'Create your Budgetly account' : mode === 'verify' ? 'Almost there' : 'Return to Budgetly'}</h1>
        <p>A clearer view of everyday spending, shared plans, and what comes next.</p>
      </section>
      <motion.main key={mode} className="auth-main" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{duration:.38,ease:[.22,1,.36,1]}}>
      {mode === 'reset' && <PasswordRecovery onBack={()=>setMode('login')}/>}

      {mode === 'login' && <>
        <h2>Welcome back</h2>
        <p className="auth-intro">Sign in to continue to your finances.</p>
        <div className="segment-control signin-method" aria-label="Sign-in method"><button type="button" disabled={busy} className={signInMethod === 'password' ? 'active' : ''} onClick={() => setSignInMethod('password')}>Password</button><button type="button" disabled={busy || !biometricSupported()} className={signInMethod === 'passkey' ? 'active' : ''} onClick={() => setSignInMethod('passkey')}>Biometric / passkey</button></div>
        {signInMethod === 'passkey' ? <div className="auth-passkey"><p className="auth-intro">Use the passkey saved to your device to sign in securely.</p>{error && <div className="form-error" role="alert">{error}</div>}{authOptions}<button className="button primary" disabled={busy} onClick={passkeyLogin}>{busy ? 'Verifying...' : 'Sign in with passkey'}</button></div> : <form onSubmit={login} className="auth-form">
          <label className="auth-entry"><span>Email</span><input required type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email address" /></label>
          <div className="auth-entry"><label htmlFor="login-password">Password</label><PasswordInput id="login-password" required minLength="8" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" /></div>
          {error && <div className="form-error">{error}</div>}
          {authOptions}
          <div className="auth-action-row"><button className="button primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button></div>
        </form>}
        <DeviceSignInPreference disabled={busy} onChange={() => { setSignInMethod('password'); setError(''); refreshSignInPreference(v => v + 1) }}/>
      </>}

      {mode === 'signup' && <>
        <h2>Create account</h2>
        <p className="auth-intro">One place for your personal and shared finances.</p>
        <form onSubmit={requestCode} className="auth-form">
          <label className="auth-entry"><span>Username</span><input required autoComplete="name" value={signup.username} onChange={e => setSignup({ ...signup, username: e.target.value })} placeholder="Your name" minLength="2" maxLength="80" /></label>
          <label className="auth-entry"><span>Email</span><input required type="email" autoComplete="email" value={signup.email} onChange={e => setSignup({ ...signup, email: e.target.value })} placeholder="you@example.com" /></label>
          <div className="auth-entry"><label htmlFor="signup-password">Password</label><PasswordInput id="signup-password" required autoComplete="new-password" value={signup.password} onChange={e => setSignup({ ...signup, password: e.target.value })} placeholder="At least 8 characters" minLength="8" maxLength="128" /></div>
          {error && <div className="form-error">{error}</div>}
          <div className="auth-action-row"><button className="button primary" disabled={busy}>{busy ? 'Sending code…' : 'Continue to email verification'}</button></div>
        </form>
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
        {mode === 'login' && <div className="auth-footer-action">New to Budgetly? <button className="auth-switch" type="button" onClick={() => { setError(''); setMode('signup') }}>Create an account</button></div>}
        {mode === 'signup' && <div className="auth-footer-action">Already have an account? <button className="auth-switch" type="button" onClick={() => { setError(''); setMode('login') }}>Sign in</button></div>}
      </motion.main>
    </div>
    <footer className="auth-footer"><BrandFooter/></footer>
  </div>
}

export default function App() {
  const { confirm, confirmation } = useConfirmation()
  const [session, setSession] = useState({ loading: true, user: null })
  const [settings, setSettings] = useState(() => ({ ...readDeviceAppearance(), currency: 'KWD', display_name: 'Budgetly', week_starts_on: 'sunday', compact_numbers: false }))
  useAppearance(settings)
  const [appearance, setAppearance] = useState({ profile_image: '', wallpaper_image: '' })
  const [refreshKey, setRefreshKey] = useState(0)
  const [toast, setToast] = useState(null)
  const [signoutRequested, setSignoutRequested] = useState(false)

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
    if (!session.user) return undefined
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
      if (!auth.token) { setSession({ loading: false, user: null }); return }
      api('/api/auth/me').then(async user => {
      const settingsOk = await loadSettings()
      setSession({ loading: false, user: settingsOk ? user : null })
      if (settingsOk) void loadAppearance()
      }).catch(() => { auth.clear(); localStorage.removeItem('flowbudget_biometric_session'); setSession({ loading: false, user: null }) })
    }
    void resume()
  }, [loadSettings, loadAppearance])

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
    await loadSettings()
    setSession({ loading: false, user })
    void loadAppearance()
  }, [loadSettings, loadAppearance])

  const value = useMemo(() => ({
    user: session.user, settings, setSettings, appearance, setAppearance,
    refreshKey, refresh, notify, confirm, reloadSettings: loadSettings, reloadAppearance: loadAppearance, lock: signOut,
  }), [session.user, settings, appearance, refreshKey, refresh, notify, confirm, loadSettings, loadAppearance, signOut])

  if (session.loading) return <div className="app-loading"><BrandLogo className="pulse" /></div>
  if (!session.user) return <LoginScreen onLogin={completeLogin} />

  return <AppContext.Provider value={value}>
    <Experience />
    <div className="ambient" aria-hidden="true"><i/><i/><i/></div>
    <AppShell>
      <Suspense fallback={<div role="status">Loading page...</div>}>
      <Routes>
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
        <Route path="/settings" element={<Settings />} />
        <Route path="/bank-messages" element={<BankMessages />} />
        <Route path="/admin" element={session.user?.role === 'admin' ? <Admin /> : <Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </AppShell>
    <FeedbackPrompt signoutRequested={signoutRequested} onSignoutComplete={finishSignOut}/>
    {confirmation}
    <AnimatePresence>{toast && <motion.div role={toast.type === 'error' ? 'alert' : 'status'} className={`toast ${toast.type}`} initial={{ opacity: 0, y: -18, scale: .96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -12 }}>{toast.message}{toast.action && <button className="toast-action" onClick={() => {const action=toast.action;setToast(null);void action.run().catch(err=>notify(err.message,'error'))}}>{toast.action.label}</button>}</motion.div>}</AnimatePresence>
  </AppContext.Provider>
}
