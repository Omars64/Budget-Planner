import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, RefreshCw } from 'lucide-react'
import Modal from './Modal'
import { fetchWindowsRelease, newerVersion } from '../lib/appUpdates'
import { version } from '../../package.json'

const phases = {
  preparing: 'Checking for the latest signed update…',
  downloading: 'Downloading the update…',
  verifying: 'Verifying the publisher signature…',
  restarting: 'Installing and restarting Budgetly…',
}

export default function WindowsUpdate({ settings = false, children }) {
  const desktop = window.budgetlyDesktop
  const enabled = desktop && desktop.updateChannel !== 'store'
  const [release, setRelease] = useState(null)
  const [open, setOpen] = useState(false)
  const [canInstall, setCanInstall] = useState(null)
  const [progress, setProgress] = useState(null)
  const installing = progress !== null
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)
  const [message, setMessage] = useState('')
  const pending = useRef(null)
  const check = useCallback(async (manual = false) => {
    if (!enabled || installing || (!manual && document.visibilityState === 'hidden')) return
    if (pending.current && !manual) return
    pending.current?.abort()
    const controller = new AbortController()
    pending.current = controller
    const timeout = window.setTimeout(() => controller.abort(), 15000)
    setChecking(manual)
    if (manual) setMessage('')
    try {
      const value = await fetchWindowsRelease(controller.signal)
      if (pending.current !== controller) return
      if (value && newerVersion(value.version, desktop.version || version)) {
        if (manual || sessionStorage.getItem(`budgetly-windows-update-dismissed-${value.version}`) !== 'yes') {
          setRelease(value)
          setOpen(true)
        }
      } else if (manual) setMessage('You have the latest published Windows version.')
    } catch {
      if (manual && pending.current === controller) setMessage('Could not check for Windows updates. Try again when connected.')
    } finally {
      window.clearTimeout(timeout)
      if (pending.current === controller) {
        pending.current = null
        setChecking(false)
      }
    }
  }, [desktop, enabled, installing])
  useEffect(() => {
    if (!enabled || installing) return
    const automaticCheck = () => { void check() }
    automaticCheck()
    const timer = setInterval(automaticCheck, 6 * 60 * 60 * 1000)
    window.addEventListener('focus', automaticCheck)
    return () => {
      const controller = pending.current
      pending.current = null
      controller?.abort()
      clearInterval(timer)
      window.removeEventListener('focus', automaticCheck)
    }
  }, [check, enabled, installing])
  useEffect(() => enabled ? desktop.onUpdateProgress?.(setProgress) : undefined, [desktop, enabled])
  const signedRelease = release?.signed === true
  useEffect(() => {
    if (!open || !signedRelease || !enabled) return
    let alive = true
    setCanInstall(null)
    const check = async () => {
      let available = false
      try { available = await desktop.canInstallUpdate?.() === true } catch { /* The installed publisher could not be confirmed. */ }
      if (alive) setCanInstall(available)
    }
    void check()
    return () => { alive = false }
  }, [desktop, enabled, open, signedRelease])
  const close = () => {
    if (installing) return
    if (release) sessionStorage.setItem(`budgetly-windows-update-dismissed-${release.version}`, 'yes')
    setOpen(false)
    setError('')
  }
  const install = async () => {
    setProgress({ phase: 'preparing' })
    setError('')
    try {
      const result = await desktop.installUpdate(release.version)
      if (!result?.installing) throw new Error(result?.error || 'Could not install the Windows update.')
    } catch (failure) {
      setError(failure.message)
      setProgress(null)
    }
  }
  if (!desktop) return null
  const inlineUpdate = signedRelease && canInstall === true
  return <>
    {settings && <section className="update-settings-controls" aria-label="App updates">
      {enabled ? <button type="button" className="button ghost" disabled={checking || installing} onClick={() => void check(true)}><RefreshCw size={17}/>{checking ? 'Checking…' : 'Check updates'}</button> : <p>Microsoft Store manages updates for this installation.</p>}
      {children}
      {message && <p role="status">{message}</p>}
    </section>}
    <Modal open={open} onClose={close} title="A Windows update is ready" subtitle={release ? `Budgetly ${release.version}` : ''} layerClass="release-popup" slowEntrance
      footer={release && (inlineUpdate
        ? <button type="button" className="button primary release-action" disabled={installing} onClick={() => void install()}><Download size={18}/>{installing ? 'Updating…' : 'Update and restart'}</button>
        : <button type="button" className="button ghost" onClick={close}>Close</button>)}>
      {inlineUpdate && !installing && <p>Save any work first. Budgetly will verify the installer and reopen after the update.</p>}
      {release && !signedRelease && <p>This release is missing a verified Windows publisher signature. In-app installation is unavailable for this version.</p>}
      {signedRelease && canInstall === null && <p role="status">Checking this installation’s publisher…</p>}
      {signedRelease && canInstall === false && <p>This installation’s publisher could not be verified. Install a signed copy of Budgetly once to enable future in-app updates.</p>}
      {installing && <div className="stack gap-10">
        <p role="status">{phases[progress.phase]}</p>
        {progress.phase === 'downloading' && <progress aria-label="Windows update download" value={progress.percentage} max="100"/>}
      </div>}
      {error && <p role="alert" className="form-error">{error}</p>}
      {release && <p className="muted">Version {release.version} · {(release.size / 1000000).toFixed(1)} MB</p>}
    </Modal>
  </>
}
