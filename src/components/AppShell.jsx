import { workspaceNavigation } from '../lib/workspaceNavigation'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Bell, ChevronLeft, ChevronRight, LogOut, Menu, PanelLeftOpen, Plus, Search, ShieldCheck } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useApp } from '../App'
import TransactionModal from './TransactionModal'
import SpaceSwitcher from './SpaceSwitcher'
import BrandLogo from './BrandLogo'
import { Capacitor } from '@capacitor/core'
import { Compass } from 'lucide-react'
import AppTutorial from './AppTutorial'
import ScrollMemory from './ScrollMemory'
import Milestone from './Milestone'
import ConnectionStatus from './ConnectionStatus'
import AndroidUpdate from './AndroidUpdate'
import { useContainedScroll } from '../lib/scrollLock'
import BrandFooter from './BrandFooter'
import { useWorkspacePreferences } from '../lib/workspacePreferences'
import BankInboxBadge from './BankInboxBadge'
import useKeyboardViewport from '../lib/useKeyboardViewport'
import { LockKeyhole } from 'lucide-react'
import { guestRoutes } from '../lib/guest'
import { recordPageVisit } from '../lib/pageUsage'
import { Coffee, ExternalLink } from 'lucide-react'
import SupportPrompt from './SupportPrompt'
import { SUPPORT_URL } from '../lib/support'
import Modal from './Modal'
import { PageActionsProvider } from './PageActions'
import { api } from '../lib/api'
import { attentionKeys, useNotificationReads } from '../lib/notificationReads'

const nav = workspaceNavigation
const primaryRoutes = new Set(['/', '/transactions', '/wallets', '/upcoming'])
const groups = ['Every day', 'Your workspace', 'Planning & insights', 'Tools & support', 'Account']

export default function AppShell({ children }) {
  const navigate = useNavigate()
  const nativeAndroid = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [notificationRequest, setNotificationRequest] = useState(0)
  const [attention, setAttention] = useState(null)
  const [pageActions, setPageActions] = useState(null)
  const [floatingAction, setFloatingAction] = useState(null)
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('budgetly-sidebar-collapsed') === 'true' } catch { return false }
  })
  const toggleSidebar = () => setCollapsed(value => {
    try { localStorage.setItem('budgetly-sidebar-collapsed', String(!value)) } catch { /* Navigation works without storage. */ }
    return !value
  })
  const [navSearch, setNavSearch] = useState('')
  const [txModal, setTxModal] = useState(false)
  const [tutorialRequest, setTutorialRequest] = useState(0)
  useEffect(() => {
    const open = () => setTutorialRequest(value => value + 1)
    window.addEventListener('budgetly:open-tutorial', open)
    return () => window.removeEventListener('budgetly:open-tutorial', open)
  }, [])
  const sidebar = useRef(null)
  const navSearchInput = useRef(null)
  useEffect(() => {
    const quickFind = event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        if (document.querySelector('[aria-modal="true"], dialog[open]')) return
        event.preventDefault()
        if (nativeAndroid || window.matchMedia('(max-width: 820px)').matches) {
          navigate('/more', { state:{ focusSearch:true } })
          return
        }
        setCollapsed(false)
        window.requestAnimationFrame(() => navSearchInput.current?.focus())
      } else if (event.key === 'Escape' && document.activeElement === navSearchInput.current) {
        if (navSearch) setNavSearch('')
        navSearchInput.current?.blur()
      }
    }
    window.addEventListener('keydown', quickFind)
    return () => window.removeEventListener('keydown', quickFind)
  }, [navSearch, nativeAndroid, navigate])
  useContainedScroll(sidebar)
  const { user, settings, appearance, refresh, refreshKey, notify, lock, isGuest, requestSignIn, activeSpace, spaceKey, canAdd, bankInboxCount = 0, bankInboxLatestId = 0 } = useApp()
  const seen = useNotificationReads(isGuest ? null : user?.id, spaceKey)
  const [preferences] = useWorkspacePreferences(user?.id)
  const keyboardOpen = useKeyboardViewport()
  const location = useLocation()
  const lastVisit = useRef('')
  useEffect(() => {
    const visit = `${user?.id}:${location.pathname}`
    if (lastVisit.current === visit || !preferences.personalizedShortcuts) return
    lastVisit.current = visit
    recordPageVisit(user?.id, location.pathname)
  }, [user?.id, location.pathname, preferences.personalizedShortcuts])
  const pages = activeSpace ? nav.filter(([path]) => path !== '/ask-ai') : nav
  const visibleNav = user?.role === 'admin' ? [...pages, ['/admin', 'Admin', ShieldCheck, 'Account']] : pages
  const orderedNav = [...visibleNav].sort((a,b) => { const ia=preferences.navOrder.indexOf(a[0]), ib=preferences.navOrder.indexOf(b[0]); return ia < 0 || ib < 0 ? 0 : ia-ib })
  const matchingNav = orderedNav.filter(([, label]) => label.toLowerCase().includes(navSearch.trim().toLowerCase()))
  const isOverview = location.pathname === '/'
  const isLedger = ['/transactions', '/shared-transactions'].includes(location.pathname)
  const isUpcoming = location.pathname === '/upcoming'
  const shouldLoadAttention = !isGuest && (isOverview || notificationsOpen)
  useEffect(() => {
    if (!shouldLoadAttention) return
    const controller = new AbortController()
    api('/api/attention', { signal:controller.signal })
      .then(value => {
        if (!controller.signal.aborted && Array.isArray(value?.items)) setAttention(attentionKeys(value.items, value.generated_at))
      })
      .catch(() => { /* Keep the last available notification snapshot. */ })
    return () => controller.abort()
  }, [shouldLoadAttention, refreshKey, notificationRequest])
  const attentionUnread = attention?.filter(key => !seen.attention.includes(key)).length ?? 0
  const bankUnread = bankInboxCount > 0 && bankInboxLatestId > seen.bank
  const notificationCount = Number(bankUnread) + attentionUnread
  const notificationLabel = [
    'Notifications',
    bankUnread && 'New bank alerts',
    attentionUnread > 0 && `${attentionUnread} new attention ${attentionUnread === 1 ? 'item' : 'items'}`,
  ].filter(Boolean).join(', ')
  const isWallets = location.pathname === '/wallets'
  const pageParams = new URLSearchParams(location.search)
  const walletDetail = isWallets && Boolean(pageParams.get('wallet') || location.state?.walletId)
  const goalDetail = location.pathname === '/goals' && (pageParams.has('goal') || pageParams.has('debt'))
  const spending = location.pathname === '/spending'
  const isSettings = ['/settings','/admin'].includes(location.pathname)
  const selectedPage = visibleNav.find(([path]) => path === location.pathname)
  const subtitle = isOverview
    ? isGuest ? 'Saved on this device' : activeSpace ? 'Shared money at a glance' : 'Your money at a glance'
    : isWallets || isLedger || spending ? activeSpace?.name || 'Personal' : location.pathname === '/upcoming' ? 'See what happens next' : selectedPage?.[4]
  const greeting = new Intl.DateTimeFormat('en-GB', { timeZone:'Asia/Kuwait', hour:'numeric', hourCycle:'h23' }).format(new Date())
  const overviewTitle = isGuest ? 'Guest workspace' : activeSpace?.name || `Good ${Number(greeting) < 12 ? 'morning' : Number(greeting) < 18 ? 'afternoon' : 'evening'}, ${user?.username || 'there'}`
  const addTransaction = () => location.pathname === '/shared-transactions'
    ? window.dispatchEvent(new window.Event('budgetly:add-shared-transaction'))
    : setTxModal(true)

  return <div className={`app-shell budgetly-v2 everyday-shell ${collapsed ? 'sidebar-collapsed' : ''} ${nativeAndroid ? 'native-android' : 'browser-app'} ${isLedger ? 'has-ledger' : ''} ${(isLedger || isUpcoming) && canAdd !== false ? 'has-floating-entry' : ''} ${walletDetail ? 'has-wallet-detail' : ''} ${keyboardOpen ? 'keyboard-open' : ''} ${location.pathname === '/ask-ai' ? 'has-ai' : ''}`}>
    <ScrollMemory userId={`${user?.id}:${spaceKey}`}/>
    {!nativeAndroid && <aside ref={sidebar} className="sidebar glass">
      <div className="sidebar-head">
        <div className="brand">
          <BrandLogo style={settings.logo_style} palette={settings.color_palette} />
          <div><strong>Budgetly</strong><small>Personal finance</small></div>
        </div>
        <button className="icon-button sidebar-toggle" onClick={toggleSidebar} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed}>{collapsed ? <ChevronRight size={22}/> : <ChevronLeft size={22}/>}</button>
      </div>
      <label className="nav-finder"><Search size={17}/><input ref={navSearchInput} type="search" aria-label="Find a page" placeholder="Find a page" value={navSearch} onChange={event => setNavSearch(event.target.value)}/><kbd>Ctrl K</kbd></label>
      <div className="sidebar-space"><SpaceSwitcher/></div>
      <nav className="nav-list">
        {groups.map(group => {
          const pages = matchingNav.filter(([, , , section]) => section === group)
          return pages.length ? <div className="nav-group" key={group}><span className="nav-group-label">{group}</span>{pages.map(([to, label, Icon]) => <NavLink key={to} to={to} aria-label={label} title={label} end={to === '/'} onClick={event => {setNavSearch('');if(isGuest && !guestRoutes.has(to)){event.preventDefault();requestSignIn(label)}}} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}><Icon size={19}/><span>{label}</span>{to === '/bank-messages' && <BankInboxBadge/>}{isGuest && !guestRoutes.has(to) ? <LockKeyhole className="guest-lock" size={14}/> : label === 'Budgets' && <i className="nav-pulse"/>}</NavLink>)}</div> : null
        })}
        {!matchingNav.length && <p className="nav-no-results">No matching page</p>}
      </nav>
      {(user?.role !== 'admin' || settings.support_sidebar_enabled !== false) && <a className="sidebar-support-link" aria-label="Buy me a coffee" title="Buy me a coffee - support Budgetly" href={SUPPORT_URL} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"><Coffee size={21}/><span>Buy me a coffee<small>Support Budgetly</small></span><ExternalLink size={14}/></a>}
      <button className="button ghost sidebar-signout" onClick={lock}><LogOut size={17}/><span>{isGuest ? 'Sign in' : 'Sign out'}</span></button>
    </aside>}

    <main className="main-area">
      {!isGuest && <ConnectionStatus/>}
      <header className="topbar" role="banner">
        <div className="mobile-space"><SpaceSwitcher/></div>
        <div className="header-controls">
          {!isGuest && <button type="button" className="icon-button notification-trigger" aria-label={notificationLabel} aria-haspopup="dialog" onClick={() => { setNotificationRequest(value => value + 1); setNotificationsOpen(true) }}><Bell size={20} aria-hidden="true"/>{notificationCount > 0 && <small className="bank-inbox-badge" aria-hidden="true">{notificationCount}</small>}</button>}
          <Link to="/settings" className="header-user-tag" aria-label="Account and preferences" title={isGuest ? 'Guest' : user?.username}>
            {appearance.profile_image ? <img className="header-user-avatar" src={appearance.profile_image} alt=""/> : <span className="header-user-avatar" aria-hidden="true">{(isGuest ? 'Guest' : user?.username || 'Budgetly').slice(0,1).toUpperCase()}</span>}
          </Link>
        </div>
        {!walletDetail && !goalDetail && !isSettings && <div className="topbar-left">
          {location.pathname === '/ask-ai' && <button className="icon-button mobile-only" title="Open conversations" aria-label="Open conversations" onClick={() => window.dispatchEvent(new window.Event('budgetly:toggle-ai-history'))}><PanelLeftOpen size={20}/></button>}
          <div><h2>{isOverview ? overviewTitle : selectedPage?.[1] || 'Budgetly'}</h2>{subtitle && <p className="eyebrow">{subtitle}</p>}</div>
        </div>}
        <div className="button-row top-actions" ref={setPageActions}>
          {isOverview && !isGuest && <button className="button ghost tutorial-button" data-tour="tutorial" title="Tutorial" aria-label="Tutorial" onClick={() => setTutorialRequest(value => value + 1)}><Compass size={18}/><span>Tutorial</span></button>}
          {isWallets && !walletDetail && canAdd !== false && <button type="button" className="button primary palette-header-action" data-tour="add-wallet" onClick={() => window.dispatchEvent(new Event('budgetly:add-wallet'))}><Plus size={17}/>Add wallet</button>}
        </div>
      </header>
      <AndroidUpdate userId={user?.id} role={user?.role} guest={isGuest}/>
      {isGuest && <div className="guest-banner"><span>Guest mode · Saved on this device</span><button className="button ghost small" onClick={() => requestSignIn('cloud storage and more features')}>Sign in</button></div>}
      <motion.div className={`page-wrap${isOverview || walletDetail || goalDetail || spending || isSettings ? ' palette-page-split' : ' palette-sheet'}`} data-tour-page={location.pathname} key={location.pathname} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .18, ease: 'easeOut' }}>
        <PageActionsProvider target={pageActions} floatingTarget={floatingAction}>{children}</PageActionsProvider>
      </motion.div>
      <BrandFooter className="app-footer"/>
    </main>
    <div ref={setFloatingAction} className="floating-page-actions"/>
    {isLedger && canAdd !== false && <button data-tour="add-transaction" className="transaction-fab" aria-label="Add transaction" title="Add transaction" onClick={addTransaction}><Plus size={26} aria-hidden="true"/></button>}

    <nav className="mobile-nav glass">
      {visibleNav.filter(([to]) => primaryRoutes.has(to)).map(([to, label, Icon]) => <NavLink key={to} to={to} end={to === '/'} onClick={event => {if(isGuest && !guestRoutes.has(to)){event.preventDefault();requestSignIn(label)}}} className={({isActive}) => isActive ? 'active' : ''}><Icon size={19}/><span>{label === 'Shared Transactions' ? 'Shared' : label}</span></NavLink>)}
      <Link to="/more" aria-label="More tools" className={!primaryRoutes.has(location.pathname) ? 'active' : ''} aria-current={!primaryRoutes.has(location.pathname) ? 'page' : undefined}><Menu size={19}/><span>More</span></Link>
    </nav>

    <Modal open={notificationsOpen} onClose={() => setNotificationsOpen(false)} title="Notifications" size="small">
      <div className="notification-inbox">
        <Link className="notification-inbox-link" to="/bank-messages" onClick={() => setNotificationsOpen(false)}>
          <span><strong>Bank Inbox</strong><small>{bankInboxCount ? `${bankInboxCount} waiting for review` : 'No bank alerts waiting for review'}</small></span>{bankUnread && <span className="bank-inbox-badge">New</span>}<ChevronRight size={17} aria-hidden="true"/>
        </Link>
        <Link className="notification-inbox-link" to="/attention" onClick={() => setNotificationsOpen(false)}>
          <span><strong>Needs your attention</strong><small>{attention?.length === 0 ? 'No items to review' : 'Review budgets, plans and deadlines'}</small></span>{attentionUnread > 0 && <span className="bank-inbox-badge" aria-label={`${attentionUnread} new`}>{attentionUnread}</span>}<ChevronRight size={17} aria-hidden="true"/>
        </Link>
        <Link className="notification-inbox-link" to="/upcoming" onClick={() => setNotificationsOpen(false)}><strong>Upcoming reminders</strong><ChevronRight size={17} aria-hidden="true"/></Link>
      </div>
    </Modal>
    <TransactionModal open={txModal} onClose={() => setTxModal(false)} onSaved={(saved, scheduled) => { setTxModal(false); refresh(); notify(saved.queued ? 'Saved on this device. Will sync when connected.' : scheduled ? 'Transaction scheduled' : 'Transaction saved') }} />
    <SupportPrompt userId={user?.id} guest={isGuest} popupEnabled={settings.support_popup_enabled !== false} suppressed={notificationsOpen || keyboardOpen || txModal}/>
    {!isGuest && <><AppTutorial request={tutorialRequest}/><Milestone/></>}
  </div>
}
