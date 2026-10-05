import { useState } from 'react'
import { LocalNotifications } from '@capacitor/local-notifications'
import { androidUpdatesAvailable } from '../lib/appUpdates'
import { saveUpdateNotifications, updateNotificationsEnabled } from '../lib/notificationSettings'

export async function requestUpdatePermission() {
  if (androidUpdatesAvailable()) return (await LocalNotifications.requestPermissions()).display === 'granted'
  if ('Notification' in window) return (await window.Notification.requestPermission()) === 'granted'
  return false
}

export default function UpdateNotificationPreference({ notify }) {
  const [enabled, setEnabled] = useState(updateNotificationsEnabled)
  const change = async event => {
    const next = event.target.checked
    try {
      const granted = next ? await requestUpdatePermission() : false
      saveUpdateNotifications(next); setEnabled(next)
      if (next && !granted) notify('Update notices are enabled in the app. Device notification permission is unavailable or blocked.')
    } catch (error) { notify(error.message, 'error') }
  }
  return <label className="check-row"><input type="checkbox" checked={enabled} onChange={change}/><span>New Budgetly updates</span></label>
}
