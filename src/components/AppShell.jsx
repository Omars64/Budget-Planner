import { NavLink, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { BarChart3, BellDot, CalendarClock, CalendarDays, Gauge, LayoutDashboard, LogOut, Menu, Mountain, PanelLeftOpen, Plus, ReceiptText, Search, Settings, Share2, ShieldCheck, Target, WalletCards, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useApp } from '../App'
import TransactionModal from './TransactionModal'
import BrandLogo from './BrandLogo'
import { Capacitor } from '@capacitor/core'
import { CircleHelp, MessageSquare, NotebookPen } from 'lucide-react'
import { Compass } from 'lucide-react'
import AppTutorial from './AppTutorial'
import ScrollMemory from './ScrollMemory'
import Milestone from './Milestone'
import ConnectionStatus from './ConnectionStatus'
import AndroidUpdate from './AndroidUpdate'
import { useContainedScroll, useScrollLock } from '../lib/scrollLock'
import BrandFooter from './BrandFooter'
import { useWorkspacePreferences } from '../lib/workspacePreferences'
import useKeyboardViewport from '../lib/useKeyboardViewport'
import { LockKeyhole } from 'lucide-react'
import { guestRoutes } from '../lib/guest'

const nav = [
  ['/', 'Overview', LayoutDashboard, 'Money'],
  ['/transactions', 'Transactions', ReceiptText, 'Money'],
  ['/shared-transactions', 'Shared Transactions', Share2, 'Money'],
  ['/wallets', 'Wallets', WalletCards, 'Money'],
  ['/upcoming', 'Upcoming', CalendarClock, 'Planning'],
  ['/attention', 'Attention', BellDot, 'Planning'],
  ['/calendar', 'Calendar', CalendarDays, 'Planning'],
  ['/budgets', 'Budgets', Gauge, 'Planning'],
  ['/goals', 'Goals & debts', Target, 'Planning'],
  ['/analytics', 'Analytics', BarChart3, 'Planning'],
  ['/ask-ai', 'Ask Budgetly', CircleHelp, 'Workspace'],
  ['/notes', 'Notes', NotebookPen, 'Workspace'],
  ['/bank-messages', 'Bank messages', ReceiptText, 'Workspace'],
  ['/feedback', 'Feedback', MessageSquare, 'Workspace'],
  ['/settings', 'Settings', Settings, 'Account'],
]
const primaryRoutes = new Set(['/', '/transactions', '/shared-transactions', '/wallets'])
const groups = ['Money', 'Planning', 'Workspace', 'Account']

export default function AppShell({ children }) {
  const [menu, setMenu] = useState(false)
  const [navSearch, setNavSearch] = useState('')
  const [txModal, setTxModal] = useState(false)
  const [tutorialRequest, setTutorialRequest] = useState(0)
  const sidebar = useRef(null)
  const navSearchInput = useRef(null)
  useEffect(() => {
    const quickFind = event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        if (document.querySelector('[aria-modal="true"], dialog[open]')) return
        event.preventDefault()
        if (window.matchMedia('(max-width: 820px)').matches) setMenu(true)
        window.requestAnimationFrame(() => navSearchInput.current?.focus())
      } else if (event.key === 'Escape' && document.activeElement === navSearchInput.current) {
        if (navSearch) setNavSearch('')
        else setMenu(false)
        navSearchInput.current?.blur()
      }
    }
    window.addEventListener('keydown', quickFind)
    return () => window.removeEventListener('keydown', quickFind)
  }, [navSearch])
  useEffect(() => {
    if (!menu) return
    const back = event => {
      if (document.querySelector('[aria-modal="true"], dialog[open]')) return
      event.preventDefault(); setMenu(false)
    }
    window.addEventListener('budgetly:back', back)
    return () => window.removeEventListener('budgetly:back', back)
  }, [menu])
  useScrollLock(menu)
  useContainedScroll(sidebar)
  const { user, settings, appearance, refresh, notify, lock, isGuest, requestSignIn } = useApp()
  const [preferences] = useWorkspacePreferences(user?.id)
  const keyboardOpen = useKeyboardViewport()
  const location = useLocation()
  const visibleNav = user?.role === 'admin' ? [...nav, ['/admin', 'Admin', ShieldCheck, 'Account']] : nav
  const orderedNav = [...visibleNav].sort((a,b) => { const ia=preferences.navOrder.indexOf(a[0]), ib=preferences.navOrder.indexOf(b[0]); return ia < 0 || ib < 0 ? 0 : ia-ib })
  const matchingNav = orderedNav.filter(([, label]) => label.toLowerCase().includes(navSearch.trim().toLowerCase()))
  const title = visibleNav.find(([path]) => path === location.pathname)?.[1] || 'Budgetly'
  const isLedger = ['/transactions', '/shared-transactions'].includes(location.pathname)
  const nativeAndroid = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
  const addTransaction = () => location.pathname === '/shared-transactions'
    ? window.dispatchEvent(new window.Event('budgetly:add-shared-transaction'))
    : setTxModal(true)

  return <div className={`app-shell budgetly-v2 ${nativeAndroid ? 'native-android' : 'browser-app'} ${isLedger ? 'has-ledger' : ''} ${keyboardOpen ? 'keyboard-open' : ''} ${location.pathname === '/ask-ai' ? 'has-ai' : ''}`}>
    <ScrollMemory userId={user?.id}/>
    <aside ref={sidebar} className={`sidebar glass ${menu ? 'open' : ''}`}>
      <div className="sidebar-head">
        <div className="brand">
          <BrandLogo />
          <div><strong>Budgetly</strong><small>Personal finance</small></div>
        </div>
        <button className="icon-button mobile-only" onClick={() => setMenu(false)} aria-label="Close menu"><X size={19}/></button>
      </div>
      <label className="nav-finder"><Search size={17}/><input ref={navSearchInput} type="search" aria-label="Find a page" placeholder="Find a page" value={navSearch} onChange={event => setNavSearch(event.target.value)}/><kbd>Ctrl K</kbd></label>
      <nav className="nav-list">
        {groups.map(group => {
          const pages = matchingNav.filter(([, , , section]) => section === group)
          return pages.length ? <div className="nav-group" key={group}><span className="nav-group-label">{group}</span>{pages.map(([to, label, Icon]) => <NavLink key={to} to={to} end={to === '/'} onClick={event => {setMenu(false);setNavSearch('');if(isGuest && !guestRoutes.has(to)){event.preventDefault();requestSignIn(label)}}} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}><Icon size={19}/><span>{label}</span>{isGuest && !guestRoutes.has(to) ? <LockKeyhole className="guest-lock" size={14}/> : label === 'Budgets' && <i className="nav-pulse"/>}</NavLink>)}</div> : null
        })}
        {!matchingNav.length && <p className="nav-no-results">No matching page</p>}
      </nav>
      <button className="button ghost sidebar-signout" onClick={lock}><LogOut size={17}/><span>{isGuest ? 'Sign in' : 'Sign out'}</span></button>
      <div className="sidebar-foot glass-subtle">
        {appearance.profile_image ? <img className="sidebar-avatar" src={appearance.profile_image} alt="Profile"/> : <span className="default-avatar"><Mountain size={24}/></span>}<div><strong>{user?.username || 'Budgetly'}</strong><small>{user?.role === 'admin' ? 'Admin account' : 'Personal workspace'}</small></div>
      </div>
    </aside>
    {menu && <div className="sidebar-scrim" onClick={() => setMenu(false)} />}

    <main className="main-area">
      {!isGuest && <ConnectionStatus/>}
      <header className="topbar" role="banner">
        <div className="topbar-left">
          <button className="icon-button mobile-only" onClick={() => setMenu(true)} aria-label="Open menu"><Menu size={20}/></button>
          {location.pathname === '/ask-ai' && <button className="icon-button mobile-only" title="Open conversations" aria-label="Open conversations" onClick={() => window.dispatchEvent(new window.Event('budgetly:toggle-ai-history'))}><PanelLeftOpen size={20}/></button>}
          <div><p className="eyebrow">{settings.display_name}</p><h2>{title}</h2></div>
        </div>
        <div className="button-row top-actions">{location.pathname === '/' && !isGuest && <button className="button ghost tutorial-button" data-tour="tutorial" title="Tutorial" aria-label="Tutorial" onClick={() => { setMenu(false); setTutorialRequest(value => value + 1) }}><Compass size={18}/><span>Tutorial</span></button>}<button className="button ghost signout-button" title={isGuest ? 'Sign in' : 'Sign out'} aria-label={isGuest ? 'Sign in' : 'Sign out'} onClick={lock}><LogOut size={17}/><span>{isGuest ? 'Sign in' : 'Sign out'}</span></button>{isLedger && !nativeAndroid && <button data-tour="add-transaction" className="button primary add-button" onClick={addTransaction}><Plus size={18}/><span>Add transaction</span></button>}</div>
      </header>
      <AndroidUpdate/>
      {isGuest && <div className="guest-banner"><span>Guest mode · On this device</span><button className="button ghost small" onClick={() => requestSignIn('cloud storage and more features')}>Sign in</button></div>}
      <motion.div className="page-wrap" data-tour-page={location.pathname} key={location.pathname} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .16 }}>{children}</motion.div>
      <BrandFooter className="app-footer"/>
    </main>
    {isLedger && nativeAndroid && <button data-tour="add-transaction" className="transaction-fab" aria-label="Add transaction" title="Add transaction" onClick={addTransaction}><Plus size={28}/></button>}

    <nav className="mobile-nav glass">
      {visibleNav.filter(([to]) => primaryRoutes.has(to)).map(([to, label, Icon]) => <NavLink key={to} to={to} end={to === '/'} onClick={event => {if(isGuest && !guestRoutes.has(to)){event.preventDefault();requestSignIn(label)}}} className={({isActive}) => isActive ? 'active' : ''}><Icon size={19}/><span>{label === 'Shared Transactions' ? 'Shared' : label}</span></NavLink>)}
      <button className={!primaryRoutes.has(location.pathname) ? 'active' : ''} aria-current={!primaryRoutes.has(location.pathname) ? 'page' : undefined} onClick={() => setMenu(true)}><Menu size={19}/><span>More</span></button>
    </nav>

    <TransactionModal open={txModal} onClose={() => setTxModal(false)} onSaved={(saved, scheduled) => { setTxModal(false); refresh(); notify(saved.queued ? 'Saved on this device. Will sync when connected.' : scheduled ? 'Transaction scheduled' : 'Transaction saved') }} />
    {!isGuest && <><AppTutorial request={tutorialRequest}/><Milestone/></>}
  </div>
}
