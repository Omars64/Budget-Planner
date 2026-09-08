import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import {dateInput,saveDate,clockTime} from './time'

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
export async function configureReminder(settings) {
  if (!isNativeApp()) return false
  await LocalNotifications.cancel({ notifications:[{id:1001},...Array.from({length:30},(_,i)=>({id:1100+i}))] })
  if (!settings.reminders_enabled) return true
  const permission = await LocalNotifications.requestPermissions()
  if (permission.display !== 'granted') throw new Error('Notifications are blocked. Enable FlowBudget notifications in device Settings.')
  const time=settings.reminder_time||'20:00'
  if(quietAt(settings,time)||!reminderBody(settings))return true
  const notifications=Array.from({length:30},(_,i)=>{const day=new Date(Date.now()+i*86400000);return {id:1100+i,title:'FlowBudget',body:reminderBody(settings),schedule:{at:new Date(saveDate(dateInput(day).slice(0,10)+'T'+time)),allowWhileIdle:true}}}).filter(n=>n.schedule.at>new Date())
  if(notifications.length)await LocalNotifications.schedule({notifications})
  return true
}
export async function cancelReminder() {
  if (isNativeApp()) await LocalNotifications.cancel({notifications:[{id:1001},...Array.from({length:30},(_,i)=>({id:1100+i}))]})
}
export async function testNotification() {
  if (isNativeApp()) {
    const permission = await LocalNotifications.requestPermissions()
    if (permission.display !== 'granted') throw new Error('Enable FlowBudget notifications in device Settings.')
    await LocalNotifications.schedule({notifications:[{id:1002,title:'FlowBudget',body:'Your device notifications are ready.',schedule:{at:new Date(Date.now()+3000)}}]})
    return
  }
  if(!('Notification' in window))throw new Error('This browser cannot display device notifications. Use the installed mobile app for reminders.')
  const permission=await Notification.requestPermission()
  if(permission!=='granted')throw new Error('Notifications are blocked. Allow notifications in this site\'s browser settings.')
  try{new Notification('FlowBudget',{body:'Your browser notifications are ready while FlowBudget is open.',icon:'/flowbudget-logo.png',tag:'flowbudget-test'})}catch{throw new Error('This browser requires an installed mobile app for device notifications.')}
}
