import { useEffect } from 'react'
import { LocalNotifications } from '@capacitor/local-notifications'
import { Capacitor } from '@capacitor/core'
import { api } from './api'
import { debtChanged, debtPath, dayLabel, openItems, shiftDay } from './debtWorkspace'
import { dateKey, saveDate } from './time'

const base = 1011000000
const channel = 'budgetly-debt'
let nativeQueue = Promise.resolve()
const trackedIds = Array.from({length:40}, (_,index) => ({id:base+index}))

function nativeSync(alarms, isCurrent) {
  if (!Capacitor.isNativePlatform()) return
  const run = async () => {
    if (!isCurrent()) return
    await LocalNotifications.cancel({ notifications:trackedIds })
    if (!alarms.length || !isCurrent() || (await LocalNotifications.checkPermissions()).display !== 'granted') return
    if (Capacitor.getPlatform() === 'android') await LocalNotifications.createChannel({ id:channel, name:'Debt reminders', importance:4, visibility:-1 })
    if (!isCurrent()) return
    const now = Date.now()
    const notifications = alarms.filter(alarm => alarm.at.getTime() > now).slice(0,40)
      .map((alarm,index) => ({id:base+index,title:'Budgetly · Debt reminder',body:'A debt payment needs your attention.',
        schedule:{at:alarm.at,allowWhileIdle:true},isExactNotification:false,channelId:channel,smallIcon:'flowbudget_notification',
        extra:{budgetlyDebt:true}}))
    if (notifications.length) await LocalNotifications.schedule({ notifications })
  }
  nativeQueue = nativeQueue.then(run,run).catch(() => {})
}

function getAlarms(workspace) {
  if (!workspace?.enabled) return []
  return openItems(workspace.records).filter(({record}) => record.reminder !== null)
    .map(({record,item}) => ({record,item,at:new Date(saveDate(`${shiftDay(item.due,-record.reminder)}T09:00`))}))
    .sort((a,b)=>a.at-b.at)
}

export async function allowDebtAlerts() {
  if (Capacitor.isNativePlatform()) {
    if ((await LocalNotifications.requestPermissions()).display !== 'granted') throw new Error('Allow Budgetly notifications in device settings.')
  } else {
    if (!('Notification' in window) || await window.Notification.requestPermission() !== 'granted') {
      throw new Error('Device alerts are unavailable. Debt reminders are still available in Budgetly.')
    }
  }
  window.dispatchEvent(new Event(debtChanged))
}

export function useDebtNotifications(userId,notify,navigate) {
  useEffect(() => {
    if (!userId) return
    const native = Capacitor.isNativePlatform()
    let alive = true, handle, request, alarms = []
    const seen = new Set()
    const check = () => {
      if (!alive || document.visibilityState === 'hidden') return
      const now = new Date()
      for (const {record,item,at} of alarms) {
        if (at > now || dateKey(at) !== dateKey(now)) continue
        const key = `budgetly:debt-notification:${userId}:${item.id}:${dateKey(at)}`
        if (seen.has(key)) continue
        seen.add(key)
        try {
          if (localStorage.getItem(key)) continue
          localStorage.setItem(key,'1')
        } catch { /* The current session still deduplicates this reminder. */ }
        const text = `${record.name} · due ${dayLabel(item.due)}`
        notify(text)
        if (!native && 'Notification' in window && window.Notification.permission === 'granted') {
          try { new window.Notification('Budgetly · Debt reminder',{body:'A debt payment needs your attention.',tag:key}) } catch { /* In-app reminder remains available. */ }
        }
      }
    }
    const refresh = event => {
      if (!alive) return
      if (event?.detail?.records) {
        request?.abort()
        alarms = getAlarms(event.detail)
        check()
        nativeSync(alarms, () => alive)
        return
      }
      request?.abort()
      const controller = new AbortController()
      request = controller
      api(debtPath,{signal:controller.signal}).then(workspace=>{
        if (!alive || controller.signal.aborted) return
        alarms = getAlarms(workspace)
        check()
        nativeSync(alarms, () => alive && !controller.signal.aborted)
      }).catch(()=>{})
    }
    const logout = () => {
      alive = false
      request?.abort()
      nativeSync([],()=>true)
    }
    refresh()
    if (native) void LocalNotifications.addListener('localNotificationActionPerformed', event=>{
      if (alive && event.notification.extra?.budgetlyDebt) navigate('/debt-management',{state:{debtReminders:true}})
    }).then(listener=>{if (alive) handle=listener; else void listener.remove()}).catch(()=>{})
    const timer = window.setInterval(check,60000)
    window.addEventListener('focus',refresh)
    window.addEventListener('online',refresh)
    window.addEventListener(debtChanged,refresh)
    window.addEventListener('budgetly:auth-cleared',logout)
    return () => {
      logout()
      window.clearInterval(timer)
      window.removeEventListener('focus',refresh)
      window.removeEventListener('online',refresh)
      window.removeEventListener(debtChanged,refresh)
      window.removeEventListener('budgetly:auth-cleared',logout)
      void handle?.remove()
    }
  },[userId,notify,navigate])
}
