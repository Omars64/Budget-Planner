import { LocalNotifications } from '@capacitor/local-notifications'
import { androidUpdatesAvailable } from './appUpdates'

export async function requestUpdatePermission() {
  if (androidUpdatesAvailable()) return (await LocalNotifications.requestPermissions()).display === 'granted'
  if ('Notification' in window) return (await window.Notification.requestPermission()) === 'granted'
  return false
}

