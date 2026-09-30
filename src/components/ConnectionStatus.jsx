import { useEffect, useState } from 'react'
import { useApp } from '../App'
import { listOfflineQueue } from '../lib/offlineSync'

export default function ConnectionStatus() {
  const { user } = useApp()
  const [offline, setOffline] = useState(() => navigator.onLine === false)
  const [serviceUnavailable, setServiceUnavailable] = useState(false)
  const [waiting, setWaiting] = useState(0)
  useEffect(() => {
    const update = () => { setOffline(navigator.onLine === false); void listOfflineQueue(user?.id).then(rows => setWaiting(rows.length)).catch(() => setWaiting(0)) }
    const serviceDown = () => setServiceUnavailable(true)
    const serviceUp = () => setServiceUnavailable(false)
    update()
    window.addEventListener('online', update); window.addEventListener('offline', update)
    window.addEventListener('budgetly:offline-queue-changed', update)
    window.addEventListener('budgetly:offline-data', serviceDown)
    window.addEventListener('budgetly:service-available', serviceUp)
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); window.removeEventListener('budgetly:offline-queue-changed', update); window.removeEventListener('budgetly:offline-data', serviceDown); window.removeEventListener('budgetly:service-available', serviceUp) }
  }, [user?.id])
  return offline || serviceUnavailable || waiting ? <div className="connection-status" role="status">{offline ? 'Offline. Showing saved data.' : serviceUnavailable ? 'Service unavailable. Showing saved data.' : 'Connected.'} {waiting ? `${waiting} ${waiting === 1 ? 'entry' : 'entries'} waiting to sync.` : 'New entries will be saved on this device until you reconnect.'}</div> : null
}
