import { useEffect, useRef, useState } from 'react'
import { Download, RefreshCw, X } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { androidUpdatesAvailable, AppUpdater, fetchRelease } from '../lib/appUpdates'

export default function AndroidUpdate() {
  const { pathname } = useLocation()
  const [release, setRelease] = useState(null)
  const [status, setStatus] = useState('idle')
  const [message, setMessage] = useState('')
  const [progress, setProgress] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const mounted = useRef(false)
  const busy = useRef(false)
  const checking = useRef(null)
  const lastCheck = useRef(0)
  const enabled = androidUpdatesAvailable()
  const settings = pathname === '/settings'

  async function check(manual = false) {
    if (!enabled || busy.current || checking.current || (!manual && Date.now() - lastCheck.current < 21600000)) return
    const controller = new AbortController()
    checking.current = controller
    const timeout = setTimeout(() => controller.abort(), 15000)
    setStatus('checking'); setMessage('')
    try {
      const [info, latest] = await Promise.all([AppUpdater.info(), fetchRelease(controller.signal)])
      if (!mounted.current || controller.signal.aborted) return
      lastCheck.current = Date.now()
      setRelease(latest && latest.versionCode > info.versionCode ? latest : null)
      setDismissed(false)
      setStatus('idle')
      if (manual && !(latest && latest.versionCode > info.versionCode)) setMessage(latest ? 'You have the latest published version.' : 'No Android release has been published yet.')
    } catch {
      if (mounted.current) { setStatus('idle'); if (manual) setMessage('Could not check for updates. Try again when connected.') }
    } finally { clearTimeout(timeout); if (checking.current === controller) checking.current = null }
  }

  useEffect(() => {
    mounted.current = true
    if (!enabled) return () => { mounted.current = false }
    void check()
    const resume = () => { if (document.visibilityState === 'visible') void check() }
    window.addEventListener('online', resume)
    document.addEventListener('visibilitychange', resume)
    return () => {
      mounted.current = false; checking.current?.abort(); checking.current = null
      window.removeEventListener('online', resume)
      document.removeEventListener('visibilitychange', resume)
    }
    // This component owns one update check lifecycle, independent of page navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  async function update() {
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

  if (!enabled || (!settings && (!release || dismissed))) return null
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
