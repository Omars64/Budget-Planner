import { useEffect, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { useApp } from '../App'
import ResizablePanels from './ResizablePanels'
import { isNativeApp,quietAt,reminderBody,reminderTimes,configureReminder } from '../lib/deviceNotifications'
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
    if(isNativeApp()){
      const sync = () => {void configureReminder(settings,{requestPermission:false}).catch(e=>notify(e.message,'error'))}
      sync()
      window.addEventListener('focus',sync)
      return () => window.removeEventListener('focus',sync)
    }
    if (!settings.reminders_enabled) return
    const check = () => {
      const now = new Date()
      const day = dateKey(now)
      const time = clockTime(now)
      if(quietAt(settings,time)||!reminderBody(settings))return
      const key = `flowbudget-reminder-${user.id}`
      const slot = reminderTimes(settings).filter(t=>t<=time).at(-1)
      if (!slot) return
      const reminderKey = `${day}:${slot}`
      try {
        if (localStorage.getItem(key) === reminderKey) return
        localStorage.setItem(key, reminderKey)
      } catch { return }
      notify(reminderBody(settings))
      if ('Notification' in window && Notification.permission === 'granted') {
        try { new Notification('Budgetly', { body: reminderBody(settings), icon: '/flowbudget-logo.png', tag: 'daily-budget' }) } catch { /* The in-app reminder is still displayed. */ }
      }
    }
    check()
    const interval = setInterval(check, 30000)
    window.addEventListener('focus', check)
    return () => { clearInterval(interval); window.removeEventListener('focus', check) }
  }, [settings, user.id, notify])
  return <><SecurityPrompt/><ResizablePanels/>{pending > 0 && <div className="request-progress" role="status"><LoaderCircle className="request-spinner" size={18}/>Saving...</div>}</>
}
