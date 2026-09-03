import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { LockKeyhole, Mail, Sparkles } from 'lucide-react'
import { api, auth, jsonBody } from './lib/api'
import AppShell from './components/AppShell'
import Overview from './pages/Overview'
import Transactions from './pages/Transactions'
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
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async e => {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      const result = await api('/api/auth/login', { method: 'POST', ...jsonBody({ email, password }) })
      auth.token = result.token
      onLogin(result.user)
    } catch (err) { setError(err.message); setPassword('') }
    finally { setBusy(false) }
  }

  return <div className="lock-screen">
    <motion.div className="lock-card glass" initial={{ opacity: 0, y: 20, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }}>
      <div className="brand-mark large"><Sparkles size={24} /></div>
      <p className="eyebrow">Welcome back</p>
      <h1>Sign in to FlowBudget</h1>
      <p className="muted">Your budget workspace is private to your account.</p>
      <form onSubmit={submit} className="stack gap-12">
        <div className="pin-field">
          <Mail size={18} />
          <input autoFocus type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="email@example.com" aria-label="Email" />
        </div>
        <div className="pin-field">
          <LockKeyhole size={18} />
          <input type="password" minLength="8" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" aria-label="Password" />
        </div>
        {error && <div className="form-error">{error}</div>}
        <button className="button primary full" disabled={busy || !email || password.length < 8}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </motion.div>
  </div>
}

export default function App() {
  const [session, setSession] = useState({ loading: true, user: null })
  const [settings, setSettings] = useState({ currency: 'KWD', display_name: 'FlowBudget', week_starts_on: 'sunday', compact_numbers: false })
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

  useEffect(() => {
    if (!auth.token) { setSession({ loading: false, user: null }); return }
    api('/api/auth/me').then(async user => {
      const ok = await loadSettings()
      setSession({ loading: false, user: ok ? user : null })
    }).catch(() => { auth.clear(); setSession({ loading: false, user: null }) })
  }, [loadSettings])

  const signOut = useCallback(() => { auth.clear(); setSession({ loading: false, user: null }) }, [])
  const value = useMemo(() => ({ user: session.user, settings, setSettings, refreshKey, refresh, notify, reloadSettings: loadSettings, lock: signOut }), [session.user, settings, refreshKey, refresh, notify, loadSettings, signOut])

  if (session.loading) return <div className="app-loading"><div className="brand-mark pulse"><Sparkles /></div></div>
  if (!session.user) return <LoginScreen onLogin={async user => { await loadSettings(); setSession({ loading: false, user }) }} />

  return <AppContext.Provider value={value}>
    <div className="ambient" aria-hidden="true"><i/><i/><i/></div>
    <AppShell>
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/transactions" element={<Transactions />} />
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
