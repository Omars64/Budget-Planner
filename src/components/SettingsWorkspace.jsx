import { Children, isValidElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, Banknote, Bell, ChevronRight, CloudUpload, Coffee, Landmark, Palette, Search, ShieldCheck, Smartphone, UserRound } from 'lucide-react'
import { useAppMotion } from '../lib/appMotion'
import { SettingsInlineContext } from '../lib/settingsContext'
import './SettingsWorkspace.css'

const groups = [
  { id: 'account', title: 'Account & security', description: 'Profile, password and sign-in', icon: ShieldCheck, label: 'Your account', terms: 'password session fingerprint biometric passkey account profile' },
  { id: 'appearance', title: 'Look & feel', description: 'Theme, text size and motion', icon: Palette, label: 'Your preferences', terms: 'font colour color accent wallpaper motion vibration comfort appearance' },
  { id: 'money', title: 'Money & categories', description: 'Currency and transaction defaults', icon: Banknote, terms: 'currency kwd categories default wallet entry templates display locale week numbers budget name' },
  { id: 'notifications', title: 'Notifications', description: 'Updates, reminders and scheduled entries', icon: Bell, terms: 'upcoming expense update quiet hours reminder scheduled notification' },
  { id: 'bank', title: 'Bank messages', description: 'Connected apps and wallet matching', icon: Landmark, terms: 'smart bank inbox notification access card matching capture android' },
  { id: 'backup', title: 'Backups & data', description: 'Google Drive, exports and recovery', icon: CloudUpload, label: 'Your data', terms: 'trash deleted recovery restore google drive export statement privacy reset guest records' },
  { id: 'support', title: 'Support & about', description: 'Coffee preferences and app information', icon: Coffee, terms: 'coffee tip support popup sidebar about' },
]
const titleGroups = {
  'Personal preferences': 'appearance', 'Workspace wallpaper': 'appearance',
  'Currency configuration': 'money', 'Display & locale': 'money', 'Categories': 'money', 'Transaction entry': 'money',
  'Notifications': 'notifications', 'Smart Bank Inbox': 'bank',
  'Biometric sign-in': 'account', 'Delete account': 'account', 'Guest workspace': 'account', 'Account features': 'account',
  'Backup & restore': 'backup', 'Privacy & data': 'backup', 'Reset workspace': 'backup', 'Export and local data': 'backup',
}
const sectionOrder = { 'Biometric sign-in': 30, 'Delete account': 90, 'Reset workspace': 90, 'Privacy & data': 80, 'Categories': 20, 'Transaction entry': 30, 'Display & locale': 40 }

export default function SettingsWorkspace({ children, guest = false }) {
  const [selected, setSelected] = useState('account')
  const [displayed, setDisplayed] = useState('account')
  const [mobileDetail, setMobileDetail] = useState(false)
  const [query, setQuery] = useState('')
  const mode = useAppMotion()
  const body = useRef(null), heading = useRef(null), menuHeading = useRef(null)
  const sequence = useRef(0), direction = useRef(1)
  const instance = useId()
  const parts = Children.toArray(children).map(child => ({ child, group: isValidElement(child) ? child.props.settingsId || child.props['data-settings-id'] || titleGroups[child.props.title] : null }))
  const available = groups.filter(group => parts.some(part => part.group === group.id))
  const visible = available.filter(group => `${group.title} ${group.description} ${group.terms}`.toLowerCase().includes(query.trim().toLowerCase()))
  const current = groups.find(group => group.id === displayed)
  const Icon = current.icon

  const show = useCallback(async (id, immediate = false) => {
    const token = ++sequence.current
    direction.current = groups.findIndex(group => group.id === id) >= groups.findIndex(group => group.id === selected) ? 1 : -1
    setSelected(id)
    body.current?.getAnimations?.().forEach(animation => animation.cancel())
    if (!immediate && mode === 'full' && body.current?.getBoundingClientRect().width && body.current.animate) {
      try {
        await body.current.animate([{ opacity: 1, translate: '0px' }, { opacity: 0, translate: `${direction.current * -20}px` }], { duration: 140, easing: 'ease-in' }).finished
      } catch { /* A newer navigation supersedes the outgoing animation. */ }
    }
    if (token !== sequence.current) return
    setDisplayed(id); setMobileDetail(true)
    window.requestAnimationFrame(() => {
      if (window.matchMedia?.('(max-width: 760px)').matches) {
        body.current?.scrollIntoView?.({ block: 'start', behavior: 'instant' })
        heading.current?.focus({ preventScroll: true })
      }
    })
  }, [mode, selected])

  useLayoutEffect(() => {
    if (mode !== 'full') return
    const animation = body.current?.animate?.([{ opacity: 0, translate: `${direction.current * 30}px` }, { opacity: 1, translate: '0px' }], { duration: 480, easing: 'cubic-bezier(.16,1,.3,1)' })
    return () => animation?.cancel()
  }, [displayed, mobileDetail, mode])
  useEffect(() => () => { sequence.current++; body.current?.getAnimations?.().forEach(animation => animation.cancel()) }, [])

  useEffect(() => {
    const reveal = event => {
      const title = event.detail?.section
      const section = [...document.querySelectorAll('[data-settings-group] [data-tour-section]')].find(element => element.dataset.tourSection === title)
      const id = section?.closest('[data-settings-group]')?.dataset.settingsGroup || titleGroups[title]
      if (id) void show(id, true)
    }
    window.addEventListener('budgetly:settings-open', reveal)
    return () => window.removeEventListener('budgetly:settings-open', reveal)
  }, [show])

  const back = useCallback(() => {
    sequence.current++
    body.current?.getAnimations?.().forEach(animation => animation.cancel())
    setMobileDetail(false)
    window.requestAnimationFrame(() => { menuHeading.current?.scrollIntoView?.({ block: 'start', behavior: 'instant' }); menuHeading.current?.focus({ preventScroll: true }) })
  }, [])
  useEffect(() => {
    const handleBack = event => {
      if (event.defaultPrevented || !mobileDetail || !window.matchMedia?.('(max-width: 760px)').matches || document.querySelector('[aria-modal="true"],dialog[open]') || document.body.classList.contains('driver-active')) return
      event.preventDefault(); back()
    }
    window.addEventListener('budgetly:back', handleBack)
    return () => window.removeEventListener('budgetly:back', handleBack)
  }, [back, mobileDetail])

  return <div className="settings-workspace" data-mobile-detail={mobileDetail}>
    <aside className="settings-menu" aria-label="Settings categories">
      <h2 ref={menuHeading} tabIndex={-1}>Settings</h2>
      <label className="settings-search"><Search size={18} aria-hidden="true"/><input type="search" value={query} placeholder="Search settings" aria-label="Search settings" onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && visible[0]) { event.preventDefault(); void show(visible[0].id) } }}/></label>
      <nav aria-label="Choose a settings category">
        {visible.map(group => <div key={group.id}>
          {group.label && <p className="settings-menu-label">{group.label}</p>}
          <button type="button" className="settings-category" aria-current={selected === group.id ? 'page' : undefined} onClick={() => void show(group.id)}>
            {selected === group.id && <motion.span className="settings-selection" layoutId={`${instance}-selection`} transition={{ duration: mode === 'full' ? .38 : 0, ease: [.22, .8, .24, 1] }} aria-hidden="true"/>}
            <group.icon size={20} aria-hidden="true"/><span>{group.title}<small>{group.description}</small></span><ChevronRight size={16} aria-hidden="true"/>
          </button>
        </div>)}
        {!visible.length && <p className="muted" role="status">No matching settings.</p>}
      </nav>
    </aside>
    <div className="settings-detail" ref={body}>
      <button type="button" className="settings-back" onClick={back}><ArrowLeft size={18}/>All settings</button>
      <p className="settings-breadcrumb">Settings / {current.title}</p>
      <div className="settings-page-heading"><span className="settings-page-icon"><Icon size={25} aria-hidden="true"/></span><h2 ref={heading} tabIndex={-1}>{current.title}</h2></div>
      <p className="settings-description">{current.description}</p>
      <p className="settings-scope">{guest || ['bank', 'notifications'].includes(displayed) ? <Smartphone size={17} aria-hidden="true"/> : <UserRound size={17} aria-hidden="true"/>}{guest ? 'Guest workspace · this device' : ['bank', 'notifications'].includes(displayed) ? 'This device only' : 'Your account and selected workspace'}</p>
      <SettingsInlineContext.Provider value={true}>
        {available.map(group => <div key={group.id} data-settings-group={group.id} hidden={displayed !== group.id} aria-label={group.title}>
          {parts.filter(part => part.group === group.id).sort((a, b) =>
            (a.child.props.settingsOrder ?? a.child.props['data-settings-order'] ?? sectionOrder[a.child.props.title] ?? 10) -
            (b.child.props.settingsOrder ?? b.child.props['data-settings-order'] ?? sectionOrder[b.child.props.title] ?? 10)).map(part => part.child)}
        </div>)}
      </SettingsInlineContext.Provider>
    </div>
    {parts.filter(part => !part.group).map(part => part.child)}
  </div>
}
