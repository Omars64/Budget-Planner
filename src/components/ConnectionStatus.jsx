import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../App'
import { listOfflineQueue } from '../lib/offlineSync'
import { flushOfflineTransactions } from '../lib/api'
import './ConnectionStatus.css'

export default function ConnectionStatus() {
  const { user } = useApp()
  const [offline, setOffline] = useState(() => navigator.onLine === false)
  const [serviceUnavailable, setServiceUnavailable] = useState(false)
  const [waiting, setWaiting] = useState(0)
  const [failed, setFailed] = useState(0)
  const [scope, setScope] = useState('/transactions')
  const [syncing, setSyncing] = useState(false)
  const [queueError, setQueueError] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState('')
  const session = useRef(0)
  useEffect(() => {
    session.current += 1
    let active = true
    let latest = 0
    setWaiting(0); setFailed(0); setSyncing(false); setQueueError(false); setServiceUnavailable(false); setRetrying(false); setRetryError('')
    const update = () => {
      setOffline(navigator.onLine === false)
      const request = ++latest
      void listOfflineQueue(user?.id).then(rows => {
        if (!active || request !== latest) return
        setQueueError(false)
        if (!rows.length) setRetryError('')
        setWaiting(rows.length)
        setFailed(rows.filter(row => row.status === 'failed').length)
        setScope(rows[0]?.path.includes('/shared/') ? '/shared-transactions' : '/transactions')
      }).catch(() => { if (active && request === latest) setQueueError(true) })
    }
    const serviceDown = () => setServiceUnavailable(true)
    const serviceUp = () => setServiceUnavailable(false)
    const sync = event => {
      if (event.detail.userId !== String(user?.id)) return
      if (!event.detail.syncing) update()
      setSyncing(event.detail.syncing)
    }
    window.addEventListener('budgetly:sync-state', sync)
    update()
    window.addEventListener('online', update); window.addEventListener('offline', update)
    window.addEventListener('budgetly:offline-queue-changed', update)
    window.addEventListener('budgetly:offline-data', serviceDown)
    window.addEventListener('budgetly:service-available', serviceUp)
    return () => { active = false; session.current += 1; window.removeEventListener('budgetly:sync-state', sync); window.removeEventListener('online', update); window.removeEventListener('offline', update); window.removeEventListener('budgetly:offline-queue-changed', update); window.removeEventListener('budgetly:offline-data', serviceDown); window.removeEventListener('budgetly:service-available', serviceUp) }
  }, [user?.id])
  const retry = async () => {
    const current = session.current
    setRetrying(true); setRetryError('')
    try {
      if (!queueError) await flushOfflineTransactions()
      if (current !== session.current) return
      const rows = await listOfflineQueue(user?.id)
      if (current !== session.current) return
      setQueueError(false)
      setWaiting(rows.length)
      setFailed(rows.filter(row => row.status === 'failed').length)
      setScope(rows[0]?.path.includes('/shared/') ? '/shared-transactions' : '/transactions')
      if (rows.some(row => row.status !== 'failed')) setRetryError('Sync is not confirmed yet. Your queued entries are still on this device. Try again when the service is available.')
    } catch { if (current === session.current) { setRetryError('Could not check or sync saved entries. Keep this device’s data and try again.'); setQueueError(true) } }
    finally { if (current === session.current) setRetrying(false) }
  }
  return offline || serviceUnavailable || waiting || queueError || retrying || retryError ? <div className="connection-status connection-status-feedback">
    <div role="status" aria-live="polite" aria-atomic="true">{retrying && queueError ? 'Checking saved entries.' : retrying || syncing ? 'Syncing saved entries.' : offline ? 'Offline. Showing saved data.' : serviceUnavailable ? 'Service unavailable. Showing saved data.' : queueError ? 'Saved entries could not be checked.' : 'Server save not yet confirmed.'} {waiting ? `${waiting} ${waiting === 1 ? 'entry is' : 'entries are'} saved on this device, waiting to sync.${failed ? ` ${failed} need review.` : ''} Avoid adding them again.` : offline || serviceUnavailable ? 'Check each save result before closing the form.' : ''}</div>
    {queueError && <p role="alert">Could not read the local queue. This does not confirm that it is empty. Keep this device’s data and retry.</p>}
    {retryError && <p role="alert">{retryError}</p>}
    <div className="connection-status-actions">
      {waiting > 0 && <Link to={scope}>Review saved entries</Link>}
      {(queueError || waiting > failed) && <button type="button" disabled={offline || syncing || retrying} onClick={() => void retry()}>{retrying ? 'Retrying…' : queueError ? 'Retry queue check' : 'Retry sync'}</button>}
    </div>
  </div> : null
}
