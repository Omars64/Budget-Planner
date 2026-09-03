import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, BadgeCheck, LockKeyhole, Mail, RefreshCw, Sparkles, UserRound } from 'lucide-react'
import { api, auth, jsonBody } from './lib/api'
import AppShell from './components/AppShell'
import Overview from './pages/Overview'
import Transactions from './pages/Transactions'
import SharedTransactions from './pages/SharedTransactions'
import CalendarPage from './pages/CalendarPage'
import Analytics from './pages/Analytics'
import Budgets from './pages/Budgets'
import GoalsDebts from './pages/GoalsDebts'
import Wallets from './pages/Wallets'
import Settings from './pages/Settings'
import Admin from './pages/Admin'

const AppContext = createContext(null)
export const useApp = () => useContext(AppContext)

function LoginScreen({ onLogin }) {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [signup, setSignup] = useState({ username: '', email: '', password: '' })
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
      auth.token = result.token
      await onLogin(result.user)
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
      auth.token = result.token
      await onLogin(result.user)
    } catch (err) { setError(err.message); setCode('') }
    finally { setBusy(false) }
  }

  return <div className="lock-screen auth-screen">
    <motion.div className="lock-card auth-card glass" initial={{ opacity: 0, y: 20, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }}>
      <div className="brand-mark large"><Sparkles size={24} /></div>

      {mode === 'login' && <>
        <p className="eyebrow">Welcome back</p>
        <h1>Sign in to FlowBudget</h1>
        <p className="muted">Your budget workspace is private to your account.</p>
        <form onSubmit={login} className="stack gap-12">
          <div className="pin-field auth-field"><Mail size={18} /><input autoFocus type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email address" aria-label="Email" /></div>
          <div className="pin-field auth-field"><LockKeyhole size={18} /><input type="password" minLength="8" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" aria-label="Password" /></div>
          {error && <div className="form-error">{error}</div>}
          <button className="button primary full" disabled={busy || !email || password.length < 8}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
        <button className="auth-switch" type="button" onClick={() => { setError(''); setMode('signup') }}>New to FlowBudget? <strong>Create an account</strong></button>
      </>}

      {mode === 'signup' && <>
        <p className="eyebrow">Create account</p>
        <h1>Start your workspace</h1>
        <p className="muted">We verify your email before creating the account.</p>
        <form onSubmit={requestCode} className="stack gap-12">
          <div className="pin-field auth-field"><UserRound size={18} /><input autoFocus value={signup.username} onChange={e => setSignup({ ...signup, username: e.target.value })} placeholder="Username" aria-label="Username" minLength="2" maxLength="80" /></div>
          <div className="pin-field auth-field"><Mail size={18} /><input type="email" value={signup.email} onChange={e => setSignup({ ...signup, email: e.target.value })} placeholder="Email address" aria-label="Email" /></div>
          <div className="pin-field auth-field"><LockKeyhole size={18} /><input type="password" value={signup.password} onChange={e => setSignup({ ...signup, password: e.target.value })} placeholder="Password · 8+ characters" aria-label="Password" minLength="8" maxLength="128" /></div>
          {error && <div className="form-error">{error}</div>}
          <button className="button primary full" disabled={busy || signup.username.trim().length < 2 || !signup.email || signup.password.length < 8}>{busy ? 'Sending code…' : 'Continue'}</button>
        </form>
        <button className="auth-switch" type="button" onClick={() => { setError(''); setMode('login') }}>Already have an account? <strong>Sign in</strong></button>
      </>}

      {mode === 'verify' && <>
        <p className="eyebrow">Verify email</p>
        <h1>Enter the 6-digit code</h1>
        <p className="muted">Sent to <strong>{verificationEmail}</strong>. The code expires in 10 minutes.</p>
        <form onSubmit={verify} className="stack gap-12">
          <div className="pin-field verify-code-field"><BadgeCheck size={19} /><input autoFocus inputMode="numeric" autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" aria-label="Verification code" /></div>
          {message && !error && <div className="form-note">{message}</div>}
          {error && <div className="form-error">{error}</div>}
          <button className="button primary full" disabled={busy || code.length !== 6}>{busy ? 'Verifying…' : 'Verify & sign in'}</button>
        </form>
        <div className="auth-secondary-actions">
          <button type="button" onClick={() => { setError(''); setMessage(''); setMode('signup') }}><ArrowLeft size={14}/>Start over</button>
          <button type="button" disabled={busy || retryAfter > 0} onClick={() => requestCode()}><RefreshCw size={14}/>{retryAfter > 0 ? `Resend in ${retryAfter}s` : 'Resend code'}</button>
        </div>
      </>}
    </motion.div>
  </div>
}

export default function App() {
  const [session, setSession] = useState({ loading: true, user: null })
  const [settings, setSettings] = useState({ currency: 'KWD', display_name: 'FlowBudget', week_starts_on: 'sunday', compact_numbers: false })
  const [appearance, setAppearance] = useState({ profile_image: '', wallpaper_image: '' })
  const [refreshKey, setRefreshKey] = useState(0)
  const [toast, setToast] = useState(null)

  const notify = useCallback((message, type = 'success') => {
    setToast({ id: Date.now(), message, type })
    window.setTimeout(() => setToast(null), 2600)
  }, [])
  const refresh = useCallback(() => setRefreshKey(v => v + 1), [])

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
    const wallpaper = appearance.wallpaper_image || ''
    document.body.style.backgroundImage = wallpaper ? `url(${JSON.stringify(wallpaper)})` : ''
    document.body.style.backgroundSize = wallpaper ? 'cover' : ''
    document.body.style.backgroundPosition = wallpaper ? 'center' : ''
    document.body.style.backgroundAttachment = wallpaper ? 'fixed' : ''
    document.body.classList.toggle('has-wallpaper', Boolean(wallpaper))
    return () => {
      document.body.style.backgroundImage = ''
      document.body.style.backgroundSize = ''
      document.body.style.backgroundPosition = ''
      document.body.style.backgroundAttachment = ''
      document.body.classList.remove('has-wallpaper')
    }
  }, [appearance.wallpaper_image])

  useEffect(() => {
    if (!auth.token) { setSession({ loading: false, user: null }); return }
    api('/api/auth/me').then(async user => {
      const [settingsOk] = await Promise.all([loadSettings(), loadAppearance()])
      setSession({ loading: false, user: settingsOk ? user : null })
    }).catch(() => { auth.clear(); setSession({ loading: false, user: null }) })
  }, [loadSettings, loadAppearance])

  const signOut = useCallback(() => {
    auth.clear()
    setAppearance({ profile_image: '', wallpaper_image: '' })
    setSession({ loading: false, user: null })
  }, [])

  const completeLogin = useCallback(async user => {
    await Promise.all([loadSettings(), loadAppearance()])
    setSession({ loading: false, user })
  }, [loadSettings, loadAppearance])

  const value = useMemo(() => ({
    user: session.user, settings, setSettings, appearance, setAppearance,
    refreshKey, refresh, notify, reloadSettings: loadSettings, reloadAppearance: loadAppearance, lock: signOut,
  }), [session.user, settings, appearance, refreshKey, refresh, notify, loadSettings, loadAppearance, signOut])

  if (session.loading) return <div className="app-loading"><div className="brand-mark pulse"><Sparkles /></div></div>
  if (!session.user) return <LoginScreen onLogin={completeLogin} />

  return <AppContext.Provider value={value}>
    <div className="ambient" aria-hidden="true"><i/><i/><i/></div>
    <AppShell>
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/transactions" element={<Transactions />} />
        <Route path="/shared-transactions" element={<SharedTransactions />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/budgets" element={<Budgets />} />
        <Route path="/goals" element={<GoalsDebts />} />
        <Route path="/wallets" element={<Wallets />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/admin" element={session.user?.role === 'admin' ? <Admin /> : <Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
    <AnimatePresence>{toast && <motion.div className={`toast ${toast.type}`} initial={{ opacity: 0, y: 18, scale: .96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12 }}>{toast.message}</motion.div>}</AnimatePresence>
  </AppContext.Provider>
}
