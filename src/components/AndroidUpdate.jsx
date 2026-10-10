import { useEffect, useRef, useState } from 'react'
import { Check, Download, RefreshCw } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { useNavigate } from 'react-router-dom'
import { LocalNotifications } from '@capacitor/local-notifications'
import { androidUpdatesAvailable, AppUpdater, fetchRelease, fetchWebRelease, newerVersion } from '../lib/appUpdates'
import { notificationSettingsChangedEvent, updateNotificationsEnabled } from '../lib/notificationSettings'
import { cancelUpdateNotification, notifyAppUpdate } from '../lib/updateNotifications'
import { syncUpdatePush } from '../lib/updatePush'
import Modal from './Modal'
import { version } from '../../package.json'
import { hasSeenRelease, markReleaseSeen, releaseNotes } from '../lib/releaseNotes'

export default function AndroidUpdate({ authentication = false, userId, guest = false }) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [alerts, setAlerts] = useState(updateNotificationsEnabled)
  const [release, setRelease] = useState(null)
  const [status, setStatus] = useState('idle')
  const [message, setMessage] = useState('')
  const [progress, setProgress] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const [whatsNew, setWhatsNew] = useState(false)
  const [pendingNotes, setPendingNotes] = useState(() => !authentication && !guest && userId != null && !hasSeenRelease(userId, version) && releaseNotes(version).length > 0)
  const [manualOpen, setManualOpen] = useState(false)
  const mounted = useRef(false)
  const busy = useRef(false)
  const checking = useRef(null)
  const lastCheck = useRef(0)
  const native = androidUpdatesAvailable()
  const enabled = !authentication && !guest && userId != null
  const settings = enabled && pathname === '/settings'
  const currentNotes = releaseNotes(version)

  useEffect(() => {
    if (authentication || guest || userId == null || hasSeenRelease(userId, version) || !currentNotes.length) return
    const timer = setInterval(() => {
      if (document.visibilityState === 'hidden' || document.querySelector('[aria-modal="true"], dialog[open]') || document.body.classList.contains('driver-active')) return
      setWhatsNew(true)
      setPendingNotes(false)
      clearInterval(timer)
    }, 800)
    return () => clearInterval(timer)
    // Release notes are fixed for the installed build.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authentication, guest, userId])

  function closeWhatsNew() {
    markReleaseSeen(userId, version)
    setWhatsNew(false)
  }

  async function check(manual = false, resumed = false) {
    if (!enabled || busy.current || checking.current || (!manual && Date.now() - lastCheck.current < (resumed ? 300000 : 21600000))) return
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
      if (manual && available && native) setManualOpen(true)
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
    const resume = () => { if (document.visibilityState === 'visible') void check(false, true) }
    window.addEventListener('online', resume)
    window.addEventListener('focus', resume)
    document.addEventListener('visibilitychange', resume)
    return () => {
      mounted.current = false; checking.current?.abort(); checking.current = null
      clearInterval(timer)
      window.removeEventListener('online', resume)
      window.removeEventListener('focus', resume)
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
    if (release && alerts) void notifyAppUpdate(release, () => { setDismissed(false); setManualOpen(true); navigate('/settings') }).catch(() => {})
  }, [release, alerts, navigate])
  useEffect(() => {
    if (!native || !enabled) return
    let disposed = false, handle
    void LocalNotifications.addListener('localNotificationActionPerformed', action => {
      if (action.notification.extra?.budgetlyUpdate) { setDismissed(false); setManualOpen(true); navigate('/settings'); lastCheck.current = 0; void check(true) }
    }).then(listener => { if (disposed) void listener.remove(); else handle = listener }).catch(() => {})
    return () => { disposed = true; void handle?.remove() }
    // Listener owns the native update notification, not page-specific data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [native, navigate, enabled])

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

  const downloading = status === 'downloading'
  const availableOpen = enabled && native && !!release && !whatsNew && !pendingNotes && (manualOpen || (alerts && !dismissed))
  const notes = release ? releaseNotes(release.version, release.notes) : []
  const renderNotes = items => <ul className="release-change-list">{items.map(item => <li key={item.title}><Check size={17} aria-hidden="true"/><div><strong>{item.title}</strong><p>{item.detail}</p></div></li>)}</ul>
  return <>
    {settings && <section className="update-settings-controls" aria-label="App updates">
      <button className="button ghost" disabled={status === 'checking'} onClick={() => {
        if (release && native) { setManualOpen(true); setDismissed(false) }
        else if (release) window.location.reload()
        else void check(true)
      }}><RefreshCw size={17}/>{status === 'checking' ? 'Checking...' : release ? native ? 'View update' : 'Refresh to latest version' : 'Check updates'}</button>
      {!!currentNotes.length && !authentication && <button className="button ghost" onClick={() => setWhatsNew(true)}>What's new</button>}
      {message && !availableOpen && <p role="status">{message}</p>}
    </section>}
    <Modal open={availableOpen} onClose={() => { setDismissed(true); setManualOpen(false) }}
      title="A fresh update is ready" subtitle={release ? `Budgetly ${release.version}` : ''} layerClass="release-popup" slowEntrance
      footer={<button className="button primary release-action" disabled={downloading} onClick={() => {
        if (status === 'ready') void install().catch(error => setMessage(error.message || 'Could not open the installer. Please retry.'))
        else void update()
      }}><Download size={18}/>{downloading ? `Downloading... ${progress}%` : status === 'ready' ? 'Install update' : 'Update now'}</button>}>
      <p className="release-intro">A few improvements to make Budgetly more dependable.</p>
      {notes.length ? renderNotes(notes) : <p className="muted">Release notes aren't available for this version.</p>}
      {release && <div className="release-meta"><span>Android update</span><span>{Number.isFinite(release.size) ? `${(release.size / 1000000).toFixed(1)} MB` : ''}</span></div>}
      {downloading && <progress aria-label="Update download" value={progress} max="100"/>}
      {message && <p className="release-status" role="status">{message}</p>}
    </Modal>
    <Modal open={whatsNew} onClose={closeWhatsNew} title="What's new" subtitle={`Budgetly ${version}`} layerClass="release-popup" slowEntrance
      footer={<button className="button primary release-action" onClick={closeWhatsNew}>Continue to Budgetly</button>}>
      <p className="release-intro">You're up to date. Here's what changed in this release.</p>
      {renderNotes(currentNotes)}
    </Modal>
  </>
}
