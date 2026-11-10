import { Link, useLocation } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { ChevronRight, Coffee, Compass, ExternalLink, LockKeyhole, LogOut, Search, ShieldCheck } from 'lucide-react'
import { useApp } from '../App'
import { workspaceNavigation } from '../lib/workspaceNavigation'
import { useWorkspacePreferences } from '../lib/workspacePreferences'
import { guestRoutes } from '../lib/guest'
import { SUPPORT_URL } from '../lib/support'
import BankInboxBadge from '../components/BankInboxBadge'

const directory = [
  ['Plan ahead', ['/planner', '/upcoming', '/calendar', '/attention']],
  ['Understand your money', ['/budgets', '/goals', '/analytics', '/spending']],
  ['Your workspace', ['/bank-messages', '/spaces', '/notes']],
  ['Help and account', ['/ask-ai', '/feedback', '/settings']],
]

export default function More() {
  const { user, activeSpace, isGuest, requestSignIn, settings, lock } = useApp()
  const location = useLocation()
  const finder = useRef(null)
  const [query, setQuery] = useState('')
  useEffect(() => { if (location.state?.focusSearch) finder.current?.focus() }, [location.key, location.state?.focusSearch])
  const [preferences] = useWorkspacePreferences(user?.id)
  const term = query.trim().toLowerCase()
  const pages = workspaceNavigation.filter(([path,label,,,description]) => (!activeSpace || path !== '/ask-ai') && `${label} ${description}`.toLowerCase().includes(term))
  const groups = directory.map(([title, paths]) => [title, paths.map(path => pages.find(page => page[0] === path)).filter(Boolean)]).filter(([,items]) => items.length)
  return <div className="everyday-page more-page stack gap-24">
    <label className="more-finder"><Search size={18} aria-hidden="true"/><input ref={finder} type="search" aria-label="Find a tool" placeholder="Find a tool" value={query} onChange={event => setQuery(event.target.value)}/></label>
    {!groups.length && <p className="muted" role="status">No matching tools.</p>}
    {groups.map(([group,items]) => <section className="everyday-section" key={group} aria-label={group}>
      <div className="everyday-section-heading"><h3>{group}</h3></div>
      <div className="more-directory">{items.sort((a, b) => {
        const left = preferences.navOrder.indexOf(a[0]), right = preferences.navOrder.indexOf(b[0])
        return left < 0 || right < 0 ? 0 : left - right
      }).map(([path, label, Icon, , description]) => <Link className="more-tool glass" to={path} key={path} onClick={event => {
        if (isGuest && !guestRoutes.has(path)) { event.preventDefault(); requestSignIn(label) }
      }}><span className="more-tool-icon"><Icon size={21}/></span><span><strong>{label}</strong><small>{description}</small></span>{path === '/bank-messages' && <BankInboxBadge/>}{isGuest && !guestRoutes.has(path) ? <LockKeyhole size={16}/> : <ChevronRight size={17}/>}</Link>)}</div>
    </section>)}
    {!isGuest && <button type="button" className="more-tool glass" data-tour="tutorial" onClick={() => window.dispatchEvent(new Event('budgetly:open-tutorial'))}><Compass/><span><strong>Budgetly walkthrough</strong><small>A guided tour of the app</small></span><ChevronRight/></button>}
    {user?.role === 'admin' && <Link className="more-tool glass" to="/admin"><ShieldCheck/><span><strong>Admin controls</strong><small>Service health, users and resource controls</small></span><ChevronRight/></Link>}
    {(user?.role !== 'admin' || settings.support_sidebar_enabled !== false) && <a className="more-tool glass" href={SUPPORT_URL} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"><Coffee/><span><strong>Buy me a coffee</strong><small>Optional support for Budgetly</small></span><ExternalLink size={16}/></a>}
    <div className="more-signout-section"><button type="button" className="more-tool glass" onClick={lock}><LogOut/><span><strong>{isGuest ? 'Sign in' : 'Sign out'}</strong><small>{isGuest ? 'Continue with your Budgetly account' : 'Leave this session on this device'}</small></span><ChevronRight size={17}/></button></div>
  </div>
}
