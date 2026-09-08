import { useEffect, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { useApp } from '../App'
import ResizablePanels from './ResizablePanels'
import { isNativeApp,quietAt,reminderBody,configureReminder } from '../lib/deviceNotifications'
import {dateKey,clockTime} from '../lib/time'
import { syncBankSms } from '../lib/bankSms'
import SecurityPrompt from './SecurityPrompt'

export default function Experience() {
  const { settings, user, notify } = useApp()
  const [pending, setPending] = useState(0)
  useEffect(() => {
    const sync = () => { void syncBankSms(user.id).catch(e => notify(e.message, 'error')) }
    sync()
    window.addEventListener('focus', sync)
    return () => window.removeEventListener('focus', sync)
  }, [user.id, notify])
  useEffect(() => {
    let active = 0
    const progress = e => { active = e.detail; setPending(active) }
    const failed = e => notify(e.detail, 'error')
    const submit = e => {
      if (active && !e.target.matches('[data-reauth]')) { e.preventDefault(); e.stopImmediatePropagation(); notify('Please wait for the current request to finish.') }
    }
    const invalid = e => {
      const label = e.target.getAttribute('aria-label') || e.target.closest('label')?.querySelector('span')?.textContent || e.target.placeholder || 'This field'
      notify(`${label}: ${e.target.validationMessage}`, 'error')
    }
    window.addEventListener('flowbudget:pending', progress)
    window.addEventListener('flowbudget:error', failed)
    document.addEventListener('submit', submit, true)
    document.addEventListener('invalid', invalid, true)
    return () => {
      window.removeEventListener('flowbudget:pending', progress)
      window.removeEventListener('flowbudget:error', failed)
      document.removeEventListener('submit', submit, true)
      document.removeEventListener('invalid', invalid, true)
    }
  }, [notify])
  useEffect(() => {
    const fonts = { system: 'system-ui, sans-serif', arial: 'Arial, sans-serif', georgia: 'Georgia, serif', verdana: 'Verdana, sans-serif' }
    const colours = { ink: '#172c38', charcoal: '#242424', forest: '#193c32' }
    document.documentElement.style.setProperty('--app-font', fonts[settings.font_family] || fonts.system)
    document.documentElement.style.setProperty('--text', colours[settings.text_color] || colours.ink)
    const accent = /^#[0-9a-f]{6}$/i.test(settings.accent_color || '') ? settings.accent_color : '#0a4173'
    const rgb = accent.match(/[0-9a-f]{2}/gi).map(value => parseInt(value, 16)).join(', ')
    document.documentElement.style.setProperty('--accent', accent)
    document.documentElement.style.setProperty('--accent-rgb', rgb)
    document.documentElement.style.setProperty('--accent-soft', `rgba(${rgb}, .10)`)
    return () => { ['--app-font', '--text', '--accent', '--accent-rgb', '--accent-soft'].forEach(key => document.documentElement.style.removeProperty(key)) }
  }, [settings.font_family, settings.text_color, settings.accent_color])
  useEffect(() => {
    if(isNativeApp()){void configureReminder(settings).catch(e=>notify(e.message,'error'));return}
    if (!settings.reminders_enabled) return
    const check = () => {
      const now = new Date()
      const day = dateKey(now)
      const time = clockTime(now)
      if(quietAt(settings,time)||!reminderBody(settings))return
      const key = `flowbudget-reminder-${user.id}`
      if (time < (settings.reminder_time || '20:00')) return
      try {
        if (localStorage.getItem(key) === day) return
        localStorage.setItem(key, day)
      } catch { return }
      notify(reminderBody(settings))
      if ('Notification' in window && Notification.permission === 'granted') {
        try { new Notification('FlowBudget', { body: reminderBody(settings), icon: '/flowbudget-logo.png', tag: 'daily-budget' }) } catch { /* The in-app reminder is still displayed. */ }
      }
    }
    check()
    const interval = setInterval(check, 30000)
    window.addEventListener('focus', check)
    return () => { clearInterval(interval); window.removeEventListener('focus', check) }
  }, [settings, user.id, notify])
  return <><SecurityPrompt/><ResizablePanels/>{pending > 0 && <div className="request-progress" role="status"><LoaderCircle className="request-spinner" size={18}/>Saving...</div>}</>
}
