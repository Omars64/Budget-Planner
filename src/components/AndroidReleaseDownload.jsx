import { useContext, useEffect, useState } from 'react'
import { Download, ExternalLink, RefreshCw } from 'lucide-react'
import { fetchRelease, RELEASES_URL } from '../lib/appUpdates'
import { SettingsVisibleContext } from '../lib/settingsContext'

const unavailable = 'Unable to check the latest Android version. Connect to the internet and try again.'

export default function AndroidReleaseDownload() {
  const active = useContext(SettingsVisibleContext)
  const [release, setRelease] = useState(null)
  const [status, setStatus] = useState('idle')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    setStatus('loading')
    setRelease(null)
    const timeout = window.setTimeout(() => {
      controller.abort()
      setStatus('error')
    }, 15000)
    fetchRelease(controller.signal).then(value => {
      if (controller.signal.aborted) return
      setRelease(value)
      setStatus(value ? 'ready' : 'empty')
    }).catch(() => {
      if (!controller.signal.aborted) setStatus('error')
    }).finally(() => window.clearTimeout(timeout))
    return () => { window.clearTimeout(timeout); controller.abort() }
  }, [active, retry])

  return <div className="stack gap-16" aria-busy={status === 'loading'}>
    <p>Get the latest published Budgetly app for your Android phone.</p>
    <div role="status" aria-live="polite">
      {status === 'loading' && <p className="muted">Checking the latest Android release…</p>}
      {status === 'error' && <p className="form-error">{unavailable}</p>}
      {status === 'empty' && <p className="muted">No Android release is currently published.</p>}
      {release && <p><strong>Latest Android release: v{release.version}</strong><br/><span className="muted">{(release.size / 1000000).toFixed(1)} MB · APK for Android</span></p>}
    </div>
    <div className="button-row">
      {release && <a className="button primary" href={release.url} target="_blank" rel="noopener noreferrer"><Download size={19} aria-hidden="true"/>Download Budgetly APK</a>}
      <a className="button ghost" href={release ? `${RELEASES_URL}/tag/v${release.version}` : RELEASES_URL} target="_blank" rel="noopener noreferrer"><ExternalLink size={18} aria-hidden="true"/>{release ? 'Release notes' : 'Browse releases'}</a>
      <button type="button" className="button ghost" disabled={status === 'loading'} onClick={() => setRetry(value => value + 1)}><RefreshCw size={18} aria-hidden="true"/>Check latest version</button>
    </div>
    <p className="muted">To update, install over your existing Budgetly app. Do not uninstall it first.</p>
  </div>
}
