import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import {dateInput,saveDate} from './time'

export function quietAt(settings,time){
  if(!settings.quiet_hours_enabled)return false
  const start=settings.quiet_start||'22:00',end=settings.quiet_end||'08:00'
  return start===end || (start<end?time>=start&&time<end:time>=start||time<end)
}
export function reminderBody(settings){
  const labels={daily:'record your transactions',budgets:'review budget limits',bills:'check upcoming bills',debts:'review debt payments'}
  const topics=[...new Set(settings.reminder_topics||['daily'])].map(k=>labels[k]).filter(Boolean)
  return topics.length?'Take a moment to '+topics.join(', ')+'.':''
}

export const isNativeApp = () => Capacitor.isNativePlatform()
const reminderIds = [{id:1001}, ...Array.from({length:30},(_,i)=>({id:1100+i}))]
let reminderQueue = Promise.resolve()

export function reminderTimes(settings) {
  const hours = [1,2,3,4,6,8,12,24].includes(settings.reminder_interval_hours) ? settings.reminder_interval_hours : 4
  const [hour,minute] = (settings.reminder_time || '20:00').split(':').map(Number)
  return Array.from({length:24/hours},(_,i)=>{
    const minutes = (hour*60+minute+i*hours*60)%1440
    return `${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`
  }).sort().filter(time=>!quietAt(settings,time))
}

export function configureReminder(settings, {requestPermission = true} = {}) {
  // Serialize settings saves, resume events and sign-out so schedules cannot overlap.
  const run = async () => {
    if (!isNativeApp()) return false
    if (!settings.reminders_enabled) {
      await LocalNotifications.cancel({notifications:reminderIds})
      return true
    }
    const permission = await (requestPermission ? LocalNotifications.requestPermissions() : LocalNotifications.checkPermissions())
    if (permission.display !== 'granted') {
      if (requestPermission) throw new Error('Notifications are blocked. Enable Budgetly notifications in device Settings.')
      return false
    }
    const body = reminderBody(settings)
    const notifications = body ? reminderTimes(settings).map((time,i)=>{
      const local = new Date(saveDate(dateInput().slice(0,10)+'T'+time))
      return {id:1100+i,title:'Budgetly',body,channelId:'budgetly-reminders',isExactNotification:false,
        schedule:{on:{hour:local.getHours(),minute:local.getMinutes(),second:0},allowWhileIdle:true}}
    }) : []
    if (Capacitor.getPlatform() === 'android') await LocalNotifications.createChannel({id:'budgetly-reminders',name:'Transaction reminders',importance:4,visibility:0})
    await LocalNotifications.cancel({notifications:reminderIds})
    if (notifications.length) await LocalNotifications.schedule({notifications})
    return true
  }
  const result = reminderQueue.then(run,run)
  reminderQueue = result.catch(()=>{})
  return result
}
export const cancelReminder = () => configureReminder({reminders_enabled:false})
export async function testNotification() {
  if (isNativeApp()) {
    const permission = await LocalNotifications.requestPermissions()
    if (permission.display !== 'granted') throw new Error('Enable Budgetly notifications in device Settings.')
    await LocalNotifications.schedule({notifications:[{id:1002,title:'Budgetly',body:'Your device notifications are ready.',isExactNotification:false,schedule:{at:new Date(Date.now()+3000)}}]})
    return
  }
  if(!('Notification' in window))throw new Error('This browser cannot display device notifications. Use the installed mobile app for reminders.')
  const permission=await Notification.requestPermission()
  if(permission!=='granted')throw new Error('Notifications are blocked. Allow notifications in this site\'s browser settings.')
  try{new Notification('Budgetly',{body:'Your browser notifications are ready while Budgetly is open.',icon:'/flowbudget-logo.png',tag:'flowbudget-test'})}catch{throw new Error('This browser requires an installed mobile app for device notifications.')}
}
