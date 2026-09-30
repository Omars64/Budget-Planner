import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../App'
import { listOfflineQueue } from '../lib/offlineSync'

export default function ConnectionStatus() {
  const { user } = useApp()
  const [offline, setOffline] = useState(() => navigator.onLine === false)
  const [serviceUnavailable, setServiceUnavailable] = useState(false)
  const [waiting, setWaiting] = useState(0)
  const [failed, setFailed] = useState(0)
  const [scope, setScope] = useState('/transactions')
  const [syncing, setSyncing] = useState(false)
  useEffect(() => {
    let active = true
    setWaiting(0); setFailed(0); setSyncing(false)
    const update = () => { setOffline(navigator.onLine === false); void listOfflineQueue(user?.id).then(rows => { if (!active) return; setWaiting(rows.length); setFailed(rows.filter(row => row.status === 'failed').length); setScope(rows[0]?.path.includes('/shared/') ? '/shared-transactions' : '/transactions') }).catch(() => {}) }
    const serviceDown = () => setServiceUnavailable(true)
    const serviceUp = () => setServiceUnavailable(false)
    const sync = event => { if (event.detail.userId === String(user?.id)) setSyncing(event.detail.syncing) }
    window.addEventListener('budgetly:sync-state', sync)
    update()
    window.addEventListener('online', update); window.addEventListener('offline', update)
    window.addEventListener('budgetly:offline-queue-changed', update)
    window.addEventListener('budgetly:offline-data', serviceDown)
    window.addEventListener('budgetly:service-available', serviceUp)
    return () => { active = false; window.removeEventListener('budgetly:sync-state', sync); window.removeEventListener('online', update); window.removeEventListener('offline', update); window.removeEventListener('budgetly:offline-queue-changed', update); window.removeEventListener('budgetly:offline-data', serviceDown); window.removeEventListener('budgetly:service-available', serviceUp) }
  }, [user?.id])
  return offline || serviceUnavailable || waiting ? <div className="connection-status" role="status">{offline ? 'Offline. Showing saved data.' : serviceUnavailable ? 'Service unavailable. Showing saved data.' : syncing ? 'Syncing saved entries.' : 'Connected.'} {waiting ? `${waiting} ${waiting === 1 ? 'entry' : 'entries'} waiting to sync.${failed ? ` ${failed} need review.` : ''}` : 'New entries will be saved on this device until you reconnect.'}{waiting > 0 && <Link to={scope}>Review saved entries</Link>}</div> : null
}
