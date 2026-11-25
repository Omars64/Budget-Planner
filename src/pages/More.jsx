import { Link, useLocation } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { ChevronRight, Coffee, Compass, ExternalLink, LockKeyhole, LogOut, Search, ShieldCheck } from 'lucide-react'
import { useApp } from '../App'
import { workspaceNavigation } from '../lib/workspaceNavigation'
import { useWorkspacePreferences } from '../lib/workspacePreferences'
import { guestRoutes } from '../lib/guest'
import { SUPPORT_URL } from '../lib/support'

const directory = [
  ['Plan ahead', ['/planner', '/upcoming', '/calendar', '/attention']],
  ['Understand your money', ['/budgets', '/goals', '/debt-management', '/analytics', '/spending']],
  ['Explore', ['/after-hours', '/spending-map']],
  ['Your workspace', ['/bank-messages', '/spaces', '/notes', '/workbooks']],
  ['Help and account', ['/ask-ai', '/feedback', '/settings']],
]
const shortDescriptions = {
  '/after-hours':'Miami stations, music and money reviews',
  '/spending-map':'Tap a category to see this month’s activity by day',
  '/planner':'Cash flow forecast',
  '/attention':'Budget and deadline alerts',
  '/goals':'Savings goals and repayments',
  '/debt-management':'Loans and money lent',
  '/analytics':'Spending and income trends',
  '/spaces':'Manage shared workspaces',
  '/workbooks':'Import and edit spreadsheets',
  '/ask-ai':'Ask about your activity',
}

export default function More() {
  const { user, activeSpace, isGuest, requestSignIn, settings, lock, bankInboxCount } = useApp()
  const location = useLocation()
  const finder = useRef(null)
  const [query, setQuery] = useState('')
  useEffect(() => { if (location.state?.focusSearch) finder.current?.focus() }, [location.key, location.state?.focusSearch])
  const [preferences] = useWorkspacePreferences(user?.id)
  const term = query.trim().toLowerCase()
  const pages = workspaceNavigation.filter(([path,label,,,description]) => (!activeSpace || !['/ask-ai','/workbooks','/after-hours'].includes(path)) && `${label} ${description}`.toLowerCase().includes(term))
  const groups = directory.map(([title, paths]) => [title, paths.map(path => pages.find(page => page[0] === path)).filter(Boolean)]).filter(([,items]) => items.length)
  return <div className="everyday-page more-page stack gap-24">
    <label className="more-finder"><Search size={18} aria-hidden="true"/><input ref={finder} type="search" aria-label="Find a tool" placeholder="Find a tool" value={query} onChange={event => setQuery(event.target.value)}/></label>
    {!groups.length && <p className="muted" role="status">No matching tools.</p>}
    {groups.map(([group,items]) => <section className="everyday-section" key={group} aria-label={group}>
      <div className="everyday-section-heading"><h3>{group}</h3></div>
      <div className="more-directory">{items.sort((a, b) => {
        const left = preferences.navOrder.indexOf(a[0]), right = preferences.navOrder.indexOf(b[0])
        return left < 0 || right < 0 ? 0 : left - right
      }).map(([path, label, Icon]) => <Link className="more-tool glass" to={path} key={path} onClick={event => {
        if (isGuest && !guestRoutes.has(path)) { event.preventDefault(); requestSignIn(label) }
      }}><span className="more-tool-icon"><Icon size={21}/></span><span><strong>{label}</strong>
        {shortDescriptions[path] && <small>{shortDescriptions[path]}</small>}
        {path === '/bank-messages' && bankInboxCount > 0 && <small>{bankInboxCount} to review</small>}</span>{isGuest && !guestRoutes.has(path) ? <LockKeyhole size={16}/> : <ChevronRight size={17}/>}</Link>)}</div>
    </section>)}
    {!isGuest && <button type="button" className="more-tool glass" data-tour="tutorial" onClick={() => window.dispatchEvent(new Event('budgetly:open-tutorial'))}><Compass/><span><strong>Budgetly walkthrough</strong></span><ChevronRight/></button>}
    {user?.role === 'admin' && <Link className="more-tool glass" to="/admin"><ShieldCheck/><span><strong>Admin controls</strong><small>Service health, users and resource controls</small></span><ChevronRight/></Link>}
    {(user?.role !== 'admin' || settings.support_sidebar_enabled !== false) && <a className="more-tool glass" href={SUPPORT_URL} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"><Coffee/><span><strong>Buy me a coffee</strong></span><ExternalLink size={16}/></a>}
    <div className="more-signout-section"><button type="button" className="more-tool glass" onClick={lock}><LogOut/><span><strong>{isGuest ? 'Sign in' : 'Sign out'}</strong></span><ChevronRight size={17}/></button></div>
  </div>
}
