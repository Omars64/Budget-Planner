import { useEffect, useRef, useState } from 'react'
import { Download, RefreshCw, X } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { useNavigate } from 'react-router-dom'
import { LocalNotifications } from '@capacitor/local-notifications'
import { androidUpdatesAvailable, AppUpdater, fetchRelease, fetchWebRelease, newerVersion } from '../lib/appUpdates'
import { notificationSettingsChangedEvent, updateNotificationsEnabled } from '../lib/notificationSettings'
import { cancelUpdateNotification, notifyAppUpdate } from '../lib/updateNotifications'
import { syncUpdatePush } from '../lib/updatePush'

export default function AndroidUpdate() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [alerts, setAlerts] = useState(updateNotificationsEnabled)
  const [release, setRelease] = useState(null)
  const [status, setStatus] = useState('idle')
  const [message, setMessage] = useState('')
  const [progress, setProgress] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const mounted = useRef(false)
  const busy = useRef(false)
  const checking = useRef(null)
  const lastCheck = useRef(0)
  const native = androidUpdatesAvailable()
  const enabled = true
  const settings = pathname === '/settings'

  async function check(manual = false) {
    if (!enabled || busy.current || checking.current || (!manual && Date.now() - lastCheck.current < 21600000)) return
    const controller = new AbortController()
    checking.current = controller
    const timeout = setTimeout(() => controller.abort(), 15000)
    setStatus('checking'); setMessage('')
    try {
      const [info, latest] = await Promise.all([native ? AppUpdater.info() : Promise.resolve(null), native ? fetchRelease(controller.signal) : fetchWebRelease(controller.signal)])
      if (!mounted.current || controller.signal.aborted) return
      lastCheck.current = Date.now()
      const available = latest && (native ? latest.versionCode > info.versionCode : newerVersion(latest.version))
      setRelease(available ? latest : null)
      setDismissed(false)
      setStatus('idle')
      void syncUpdatePush(updateNotificationsEnabled()).catch(() => {})
      if (manual && !available) setMessage(latest ? 'You have the latest published version.' : 'No release has been published yet.')
    } catch {
      if (mounted.current) { setStatus('idle'); if (manual) setMessage('Could not check for updates. Try again when connected.') }
    } finally { clearTimeout(timeout); if (checking.current === controller) checking.current = null }
  }

  useEffect(() => {
    mounted.current = true
    if (!enabled) return () => { mounted.current = false }
    void check()
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void check() }, 21600000)
    const resume = () => { if (document.visibilityState === 'visible') void check() }
    window.addEventListener('online', resume)
    document.addEventListener('visibilitychange', resume)
    return () => {
      mounted.current = false; checking.current?.abort(); checking.current = null
      clearInterval(timer)
      window.removeEventListener('online', resume)
      document.removeEventListener('visibilitychange', resume)
    }
    // This component owns one update check lifecycle, independent of page navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  useEffect(() => {
    const changed = () => { const next = updateNotificationsEnabled(); setAlerts(next); if (!next) void cancelUpdateNotification().catch(() => {}); void syncUpdatePush(next).catch(() => {}) }
    window.addEventListener(notificationSettingsChangedEvent, changed)
    window.addEventListener('storage', changed)
    return () => { window.removeEventListener(notificationSettingsChangedEvent, changed); window.removeEventListener('storage', changed) }
  }, [])
  useEffect(() => {
    if (release && alerts) void notifyAppUpdate(release, () => { setDismissed(false); navigate('/settings') }).catch(() => {})
  }, [release, alerts, navigate])
  useEffect(() => {
    if (!native) return
    let disposed = false, handle
    void LocalNotifications.addListener('localNotificationActionPerformed', action => {
      if (action.notification.extra?.budgetlyUpdate) { setDismissed(false); navigate('/settings'); lastCheck.current = 0; void check(true) }
    }).then(listener => { if (disposed) void listener.remove(); else handle = listener }).catch(() => {})
    return () => { disposed = true; void handle?.remove() }
    // Listener owns the native update notification, not page-specific data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [native, navigate])

  async function update() {
    if (!native) { window.location.reload(); return }
    if (busy.current) return
    busy.current = true; setMessage(''); setStatus('downloading'); setProgress(0)
    let listener
    try {
      listener = await AppUpdater.addListener('downloadProgress', event => { if (mounted.current) setProgress(event.percent) })
      await AppUpdater.download(release)
      if (!mounted.current) return
      setStatus('ready')
      await install()
    } catch (error) {
      if (mounted.current) { setStatus('idle'); setMessage(error.message || 'Download failed. Please retry.') }
    } finally { await listener?.remove().catch(() => {}); busy.current = false }
  }

  async function install() {
    const result = await AppUpdater.install()
    if (mounted.current) setMessage(result.permissionRequired ? 'Allow updates from Budgetly in Android settings, then tap Install.' : 'Finish the update in the Android installer.')
  }

  if (!settings && (!alerts || !release || dismissed)) return null
  const downloading = status === 'downloading'
  return <section className="android-update" aria-label="App updates">
    <div><strong>{release ? `Budgetly ${release.version} is available` : 'App updates'}</strong>
      {downloading && <progress aria-label="Update download" value={progress} max="100"/>}
      {message && <p role="status">{message}</p>}</div>
    <div className="button-row">
      {release ? <button className="button primary" disabled={downloading} onClick={() => {
        if (status === 'ready') void install().catch(error => setMessage(error.message))
        else void update()
      }}><Download size={17}/>{downloading ? `${progress}%` : status === 'ready' ? 'Install' : 'Update'}</button>
        : <button className="button ghost" disabled={status === 'checking'} onClick={() => void check(true)}><RefreshCw size={17}/>{status === 'checking' ? 'Checking...' : 'Check updates'}</button>}
      {release && !settings && !downloading && <button className="icon-button" aria-label="Remind me later" title="Remind me later" onClick={() => setDismissed(true)}><X size={17}/></button>}
    </div>
  </section>
}
