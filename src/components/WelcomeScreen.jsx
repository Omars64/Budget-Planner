import { useEffect, useRef, useState } from 'react'
import { ArrowRight, CalendarDays, Users, Wallet } from 'lucide-react'
import Modal from './Modal'
import WelcomeGreeting from './WelcomeGreeting'
import { useWelcomeSpeed } from '../lib/welcomeAnimation'
import { useAppMotion } from '../lib/appMotion'
import WindowsReleaseDownload from './WindowsReleaseDownload'

export default function WelcomeScreen({ onGuest, returningGuest = false, renderAuth }) {
  const [authMode, setAuthMode] = useState(() => returningGuest || new URLSearchParams(window.location.search).has('reset') ? 'login' : null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [replay, setReplay] = useState(0)
  const duration = useWelcomeSpeed()
  const motion = useAppMotion()
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const isDesktop = typeof window.matchMedia === 'function' && window.matchMedia('(pointer:fine)').matches
  const enter = async () => {
    if (working) return
    setWorking(true); setError('')
    try { await onGuest() }
    catch (err) { if (active.current) setError(err.message || 'Could not open guest records. Your records have not been cleared.') }
    finally { if (active.current) setWorking(false) }
  }
  return <div className="welcome-screen" data-motion={motion} style={{ '--welcome-duration': `${duration}s` }}>
    <header className="welcome-header"><div className="welcome-installs">{isDesktop && !window.budgetlyDesktop && <WindowsReleaseDownload compact/>}</div><button type="button" className="welcome-text-button" disabled={working} onClick={() => setReplay(value => value + 1)}>Replay greeting</button></header>
    <main className="welcome-content">
      <WelcomeGreeting duration={duration} replay={replay}/>
      <div key={replay} className="welcome-arrival">
        <p className="welcome-eyebrow">A fresh start with your money</p>
        <h1>A little clarity.<br/>A lot more calm.</h1>
        <p className="welcome-description">Your spending, plans, and shared moments.<br/>One comfortable place to bring it all together.</p>
        <div className="welcome-actions"><button type="button" className="welcome-primary" disabled={working} onClick={enter}>{working ? 'Opening…' : returningGuest ? 'Return to guest workspace' : 'Try without an account'}<ArrowRight size={18} aria-hidden="true"/></button><button type="button" className="welcome-secondary" disabled={working} onClick={() => setAuthMode('signup')}>Create an account</button></div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <p className="welcome-caption">No account needed to explore. Guest records stay on this device.</p>
        <div className="welcome-benefits"><span><Wallet size={17} aria-hidden="true"/>Track your money</span><span><CalendarDays size={17} aria-hidden="true"/>Plan ahead</span><span><Users size={17} aria-hidden="true"/>Share a Space</span></div>
        <p className="welcome-signin">Already have an account? <button type="button" className="welcome-text-button" disabled={working} onClick={() => setAuthMode('login')}>Sign in</button></p>
      </div>
    </main>
    <footer className="welcome-footer">Budgetly by Omar Solanki</footer>
    <Modal open={Boolean(authMode)} onClose={() => { if (!working) setAuthMode(null) }} title="Your Budgetly account" size="small" layerClass="welcome-auth-layer">
      {authMode && <div key={authMode}>{renderAuth(authMode, setWorking)}</div>}
    </Modal>
  </div>
}
