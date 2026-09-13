import { NavLink, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { BarChart3, CalendarDays, Gauge, LayoutDashboard, LogOut, Menu, Mountain, Plus, ReceiptText, Settings, Share2, ShieldCheck, Target, WalletCards, X } from 'lucide-react'
import { useState } from 'react'
import { useApp } from '../App'
import TransactionModal from './TransactionModal'
import BrandLogo from './BrandLogo'
import { Capacitor } from '@capacitor/core'
import { NotebookPen, MessageSquare } from 'lucide-react'

const nav = [
  ['/', 'Overview', LayoutDashboard],
  ['/transactions', 'Transactions', ReceiptText],
  ['/shared-transactions', 'Shared Transactions', Share2],
  ['/calendar', 'Calendar', CalendarDays],
  ['/analytics', 'Analytics', BarChart3],
  ['/budgets', 'Budgets', Gauge],
  ['/goals', 'Goals & debts', Target],
  ['/wallets', 'Wallets', WalletCards],
  ['/notes', 'Notes', NotebookPen],
  ['/feedback', 'Feedback', MessageSquare],
  ['/bank-messages', 'Bank messages', ReceiptText],
  ['/settings', 'Settings', Settings],
]

export default function AppShell({ children }) {
  const [menu, setMenu] = useState(false)
  const [txModal, setTxModal] = useState(false)
  const { user, settings, appearance, refresh, notify, lock } = useApp()
  const location = useLocation()
  const visibleNav = user?.role === 'admin' ? [...nav, ['/admin', 'Admin', ShieldCheck]] : nav
  const title = visibleNav.find(([path]) => path === location.pathname)?.[1] || 'Budgetly'
  const isLedger = ['/transactions', '/shared-transactions'].includes(location.pathname)
  const nativeAndroid = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
  const addTransaction = () => location.pathname === '/shared-transactions'
    ? window.dispatchEvent(new window.Event('budgetly:add-shared-transaction'))
    : setTxModal(true)

  return <div className={`app-shell budgetly-v2 ${nativeAndroid ? 'native-android' : 'browser-app'} ${isLedger ? 'has-ledger' : ''}`}>
    <aside className={`sidebar glass ${menu ? 'open' : ''}`}>
      <div className="sidebar-head">
        <div className="brand">
          <BrandLogo />
          <div><strong>Budgetly</strong><small>Personal finance</small></div>
        </div>
        <button className="icon-button mobile-only" onClick={() => setMenu(false)} aria-label="Close menu"><X size={19}/></button>
      </div>
      <nav className="nav-list">
        {visibleNav.map(([to, label, Icon]) => <NavLink key={to} to={to} end={to === '/'} onClick={() => setMenu(false)} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
          <Icon size={19}/><span>{label}</span>{label === 'Budgets' && <i className="nav-pulse"/>}
        </NavLink>)}
      </nav>
      <button className="button ghost sidebar-signout" onClick={lock}><LogOut size={17}/><span>Sign out</span></button>
      <div className="sidebar-foot glass-subtle">
        {appearance.profile_image ? <img className="sidebar-avatar" src={appearance.profile_image} alt="Profile"/> : <span className="default-avatar"><Mountain size={24}/></span>}<div><strong>{user?.username || 'Budgetly'}</strong><small>{user?.role === 'admin' ? 'Admin account' : 'Personal workspace'}</small></div>
      </div>
    </aside>
    {menu && <div className="sidebar-scrim" onClick={() => setMenu(false)} />}

    <main className="main-area">
      <header className="topbar" role="banner">
        <div className="topbar-left">
          <button className="icon-button mobile-only" onClick={() => setMenu(true)} aria-label="Open menu"><Menu size={20}/></button>
          <div><p className="eyebrow">{settings.display_name}</p><h2>{title}</h2></div>
        </div>
        <div className="button-row top-actions"><button className="button ghost signout-button" title="Sign out" aria-label="Sign out" onClick={lock}><LogOut size={17}/><span>Sign out</span></button>{isLedger && !nativeAndroid && <button className="button primary add-button" onClick={addTransaction}><Plus size={18}/><span>Add transaction</span></button>}</div>
      </header>
      <motion.div className="page-wrap" key={location.pathname} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .28 }}>{children}</motion.div>
      {!nativeAndroid && <footer className="app-footer">Budgetly v2.1.0 | Powered by Omar Solanki</footer>}
    </main>
    {isLedger && nativeAndroid && <button className="transaction-fab" aria-label="Add transaction" title="Add transaction" onClick={addTransaction}><Plus size={28}/></button>}

    <nav className="mobile-nav glass">
      {visibleNav.filter(([to]) => ['/', '/transactions', '/shared-transactions', '/wallets'].includes(to)).map(([to, label, Icon]) => <NavLink key={to} to={to} end={to === '/'} className={({isActive}) => isActive ? 'active' : ''}><Icon size={19}/><span>{label === 'Shared Transactions' ? 'Shared' : label}</span></NavLink>)}
      <button onClick={() => setMenu(true)}><Menu size={19}/><span>More</span></button>
    </nav>

    <TransactionModal open={txModal} onClose={() => setTxModal(false)} onSaved={() => { setTxModal(false); refresh(); notify('Transaction saved') }} />
  </div>
}
