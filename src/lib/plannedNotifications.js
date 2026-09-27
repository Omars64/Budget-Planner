import { LocalNotifications } from '@capacitor/local-notifications'
import { api } from './api'
import { isNativeApp } from './deviceNotifications'
import { readNotificationSettings } from './notificationSettings'
import { dateInput, instant, saveDate } from './time'

const key = userId => `budgetly:upcoming-delivered:${userId}`
let lastNativeSignature = ''
let nativeQueue = Promise.resolve()
let generation = 0

function enqueueNative(task) {
  const run = nativeQueue.then(task,task)
  nativeQueue = run.catch(()=>{})
  return run
}

export async function cancelPlannedNotifications() {
  generation += 1
  lastNativeSignature = ''
  if (!isNativeApp()) return
  return enqueueNative(async () => {
    const pending = await LocalNotifications.getPending()
    const old = pending.notifications.filter(item=>item.id>=200000&&item.id<1000000000).map(item=>({id:item.id}))
    if (old.length) await LocalNotifications.cancel({notifications:old})
  })
}

export function reminderAt(row, settings) {
  const due = instant(row.date)
  const day = dateInput(due).slice(0,10)
  const [year,month,date] = day.split('-').map(Number)
  const days = Number(settings.upcoming_reminder_days || 0)
  const targetDay = new Date(Date.UTC(year,month-1,date-days)).toISOString().slice(0,10)
  const chosen = new Date(saveDate(`${targetDay}T${settings.upcoming_reminder_time || '09:00'}`))
  return new Date(Math.min(chosen.getTime(),due.getTime()-5*60000))
}

export async function syncPlannedNotifications(userId) {
  if (!userId) return
  const runGeneration = generation
  const settings = readNotificationSettings({},userId)
  const rows = await api('/api/planned-transactions')
  if (runGeneration !== generation) return
  const current = rows.filter(row => ['planned','scheduled'].includes(row.status) && row.type==='expense' && row.reminder_enabled)
  const now = Date.now()
  if (isNativeApp()) {
    const signature = JSON.stringify([userId,settings.upcoming_reminders_enabled,settings.upcoming_reminder_days,settings.upcoming_reminder_time,current.map(row=>[row.id,row.date,row.description])])
    return enqueueNative(async () => {
      if (runGeneration !== generation) return
      if (lastNativeSignature===signature) return
      const pending = await LocalNotifications.getPending()
      const old = pending.notifications.filter(item=>item.id>=200000&&item.id<1000000000).map(item=>({id:item.id}))
      if (old.length) await LocalNotifications.cancel({notifications:old})
      if (settings.upcoming_reminders_enabled) {
        const permission = await LocalNotifications.checkPermissions()
        if (permission.display==='granted') {
          const notifications = current.map(row=>({row,at:reminderAt(row,settings)})).filter(item=>item.at.getTime()>now).slice(0,60).map(({row,at})=>({id:200000+row.id,title:'Upcoming expense',body:`${row.description} · ${row.wallet_name}`,smallIcon:'flowbudget_notification',largeIcon:'flowbudget_logo',iconColor:'#0a4173',schedule:{at,allowWhileIdle:true},isExactNotification:false}))
          if (notifications.length) await LocalNotifications.schedule({notifications})
        }
      }
      lastNativeSignature=signature
    })
  }
  if (!settings.upcoming_reminders_enabled || !('Notification' in window) || window.Notification.permission!=='granted') return
  let delivered = {}
  try { delivered = JSON.parse(localStorage.getItem(key(userId))||'{}') } catch { /* Use an in-memory attempt for private mode. */ }
  for (const row of current) {
    const when = reminderAt(row,settings).getTime()
    const receipt = `${row.id}:${when}`
    if (when<=now && when>now-6*3600000 && !delivered[receipt]) {
      new window.Notification('Upcoming expense',{body:`${row.description} · ${row.wallet_name}`,icon:'/flowbudget-logo.png',tag:`budgetly-upcoming-${row.id}`})
      delivered[receipt]=now
    }
  }
  const recent = Object.fromEntries(Object.entries(delivered).filter(([,time])=>time>now-30*86400000))
  try { localStorage.setItem(key(userId),JSON.stringify(recent)) } catch { /* Browser storage may be unavailable. */ }
}
