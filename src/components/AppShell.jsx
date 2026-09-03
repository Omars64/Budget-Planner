import { NavLink, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { BarChart3, CalendarDays, Gauge, LayoutDashboard, LogOut, Menu, PiggyBank, Plus, ReceiptText, Settings, Share2, ShieldCheck, Sparkles, Target, WalletCards, X } from 'lucide-react'
import { useState } from 'react'
import { useApp } from '../App'
import TransactionModal from './TransactionModal'

const nav = [
  ['/', 'Overview', LayoutDashboard],
  ['/transactions', 'Transactions', ReceiptText],
  ['/shared-transactions', 'Shared Transactions', Share2],
  ['/calendar', 'Calendar', CalendarDays],
  ['/analytics', 'Analytics', BarChart3],
  ['/budgets', 'Budgets', Gauge],
  ['/goals', 'Goals & debts', Target],
  ['/wallets', 'Wallets', WalletCards],
  ['/settings', 'Settings', Settings],
]

export default function AppShell({ children }) {
  const [menu, setMenu] = useState(false)
  const [txModal, setTxModal] = useState(false)
  const { user, settings, appearance, refresh, notify, lock } = useApp()
  const location = useLocation()
  const visibleNav = user?.role === 'admin' ? [...nav, ['/admin', 'Admin', ShieldCheck]] : nav
  const title = visibleNav.find(([path]) => path === location.pathname)?.[1] || 'FlowBudget'

  return <div className="app-shell">
    <aside className={`sidebar glass ${menu ? 'open' : ''}`}>
      <div className="sidebar-head">
        <div className="brand">
          <span className="brand-mark"><Sparkles size={18}/></span>
          <div><strong>FlowBudget</strong><small>Personal finance</small></div>
        </div>
        <button className="icon-button mobile-only" onClick={() => setMenu(false)} aria-label="Close menu"><X size={19}/></button>
      </div>
      <nav className="nav-list">
        {visibleNav.map(([to, label, Icon]) => <NavLink key={to} to={to} end={to === '/'} onClick={() => setMenu(false)} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
          <Icon size={19}/><span>{label}</span>{label === 'Budgets' && <i className="nav-pulse"/>}
        </NavLink>)}
      </nav>
      <div className="sidebar-foot glass-subtle">
        {appearance.profile_image ? <img className="sidebar-avatar" src={appearance.profile_image} alt="Profile"/> : <PiggyBank size={22}/>}<div><strong>{user?.username || 'FlowBudget'}</strong><small>{user?.role === 'admin' ? 'Admin account' : 'Personal workspace'}</small></div>
      </div>
    </aside>
    {menu && <div className="sidebar-scrim" onClick={() => setMenu(false)} />}

    <main className="main-area">
      <header className="topbar">
        <div className="topbar-left">
          <button className="icon-button mobile-only" onClick={() => setMenu(true)} aria-label="Open menu"><Menu size={20}/></button>
          <div><p className="eyebrow">{settings.display_name}</p><h2>{title}</h2></div>
        </div>
        <div className="button-row top-actions"><button className="button ghost desktop-only" onClick={lock}><LogOut size={17}/><span>Sign out</span></button><button className="button primary add-button" onClick={() => setTxModal(true)}><Plus size={18}/><span>Add transaction</span></button></div>
      </header>
      <motion.div className="page-wrap" key={location.pathname} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .28 }}>{children}</motion.div>
    </main>

    <nav className="mobile-nav glass">
      {visibleNav.slice(0, 4).map(([to, label, Icon]) => <NavLink key={to} to={to} end={to === '/'} className={({isActive}) => isActive ? 'active' : ''}><Icon size={19}/><span>{label === 'Transactions' ? 'Activity' : label === 'Shared Transactions' ? 'Shared' : label}</span></NavLink>)}
      <button onClick={() => setMenu(true)}><Menu size={19}/><span>More</span></button>
    </nav>

    <TransactionModal open={txModal} onClose={() => setTxModal(false)} onSaved={() => { setTxModal(false); refresh(); notify('Transaction saved') }} />
  </div>
}
