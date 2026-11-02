import { Link } from 'react-router-dom'
import { ChevronRight, Coffee, Compass, ExternalLink, LockKeyhole, ShieldCheck } from 'lucide-react'
import { useApp } from '../App'
import { workspaceNavigation } from '../lib/workspaceNavigation'
import { useWorkspacePreferences } from '../lib/workspacePreferences'
import { guestRoutes } from '../lib/guest'
import { SUPPORT_URL } from '../lib/support'

export default function More() {
  const { user, activeSpace, isGuest, requestSignIn, settings } = useApp()
  const [preferences] = useWorkspacePreferences(user?.id)
  const pages = workspaceNavigation.filter(([path]) => path !== '/more' && (!activeSpace || path !== '/ask-ai'))
  const groups = [...new Set(pages.map(page => page[3]))]
  return <div className="everyday-page more-page stack gap-24">
    <p className="muted">All your tools, organised by what you want to do.</p>
    {groups.map(group => <section className="everyday-section" key={group} aria-label={group}>
      <div className="everyday-section-heading"><h3>{group}</h3></div>
      <div className="more-directory">{pages.filter(page => page[3] === group).sort((a, b) => {
        const left = preferences.navOrder.indexOf(a[0]), right = preferences.navOrder.indexOf(b[0])
        return left < 0 || right < 0 ? 0 : left - right
      }).map(([path, label, Icon, , description]) => <Link className="more-tool glass" to={path} key={path} onClick={event => {
        if (isGuest && !guestRoutes.has(path)) { event.preventDefault(); requestSignIn(label) }
      }}><span className="more-tool-icon"><Icon size={21}/></span><span><strong>{label}</strong><small>{description}</small></span>{isGuest && !guestRoutes.has(path) ? <LockKeyhole size={16}/> : <ChevronRight size={17}/>}</Link>)}</div>
    </section>)}
    {!isGuest && <button type="button" className="more-tool glass" data-tour="tutorial" onClick={() => window.dispatchEvent(new Event('budgetly:open-tutorial'))}><Compass/><span><strong>Budgetly walkthrough</strong><small>A guided tour of the app</small></span><ChevronRight/></button>}
    {user?.role === 'admin' && <Link className="more-tool glass" to="/admin"><ShieldCheck/><span><strong>Admin controls</strong><small>Service health, users and resource controls</small></span><ChevronRight/></Link>}
    {(user?.role !== 'admin' || settings.support_sidebar_enabled !== false) && <a className="more-tool glass" href={SUPPORT_URL} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"><Coffee/><span><strong>Buy me a coffee</strong><small>Optional support for Budgetly</small></span><ExternalLink size={16}/></a>}
  </div>
}
