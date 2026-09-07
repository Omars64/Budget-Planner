import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'

export const isNativeApp = () => Capacitor.isNativePlatform()
export async function configureReminder(settings) {
  if (!isNativeApp()) return false
  await LocalNotifications.cancel({ notifications:[{id:1001}] })
  if (!settings.reminders_enabled) return true
  const permission = await LocalNotifications.requestPermissions()
  if (permission.display !== 'granted') throw new Error('Notifications are blocked. Enable FlowBudget notifications in device Settings.')
  const [hour, minute] = (settings.reminder_time || '20:00').split(':').map(Number)
  await LocalNotifications.schedule({notifications:[{id:1001, title:'FlowBudget', body:'Take a moment to record your transactions.', schedule:{on:{hour,minute}, repeats:true, allowWhileIdle:true}}]})
  return true
}
export async function cancelReminder() {
  if (isNativeApp()) await LocalNotifications.cancel({notifications:[{id:1001}]})
}
export async function testNotification() {
  if (isNativeApp()) {
    const permission = await LocalNotifications.requestPermissions()
    if (permission.display !== 'granted') throw new Error('Enable FlowBudget notifications in device Settings.')
    await LocalNotifications.schedule({notifications:[{id:1002,title:'FlowBudget',body:'Your device notifications are ready.',schedule:{at:new Date(Date.now()+3000)}}]})
    return
  }
  throw new Error('Device reminder scheduling is available in the installed Android/iOS app.')
}
