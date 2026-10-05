import { useEffect, useState } from 'react'
import { Download, ExternalLink, RefreshCw } from 'lucide-react'
import BrandLogo from '../components/BrandLogo'
import BrandFooter from '../components/BrandFooter'
import { fetchRelease, RELEASES_URL } from '../lib/appUpdates'

export default function DownloadApp() {
  const [release, setRelease] = useState(null)
  const [message, setMessage] = useState('Checking the latest release...')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    fetchRelease(controller.signal).then(value => {
      if (controller.signal.aborted) return
      setRelease(value); setMessage(value ? '' : 'The Android download will appear after the first release is published.')
    }).catch(() => { if (!controller.signal.aborted) setMessage('Unable to check the latest version. Browse releases or retry.') })
    const onAbort = () => setMessage('Unable to check the latest version. Browse releases or retry.')
    controller.signal.addEventListener('abort', onAbort, { once: true })
    return () => { clearTimeout(timeout); controller.signal.removeEventListener('abort', onAbort); controller.abort() }
  }, [retry])
  return <main className="download-page">
    <header className="brand"><BrandLogo/><div><strong>Budgetly</strong><small>For Android</small></div></header>
    <section><h1>Budgetly for Android</h1><p>Your personal and shared finances, on your phone.</p>
      {release && <p>Version {release.version} · {(release.size / 1048576).toFixed(1)} MB</p>}
      <div className="button-row">{release && <a className="button primary" href={release.url}><Download size={19}/>Download APK</a>}
        <a className="button ghost" href={RELEASES_URL} target="_blank" rel="noreferrer"><ExternalLink size={18}/>Release notes</a>
        {!release && <button className="icon-button" aria-label="Retry update check" title="Retry" onClick={() => setRetry(value => value + 1)}><RefreshCw size={18}/></button>}</div>
      {message && <p role="status">{message}</p>}
      <p>Install over your existing Budgetly app. Do not uninstall it to update.</p>
      <a href="/">Open Budgetly on the web</a>
    </section>
    <BrandFooter/>
  </main>
}
