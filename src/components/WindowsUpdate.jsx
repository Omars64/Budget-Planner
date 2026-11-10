import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import Modal from './Modal'
import { fetchWindowsRelease, newerVersion } from '../lib/appUpdates'
import { version } from '../../package.json'

export default function WindowsUpdate() {
  const [release, setRelease] = useState(null)
  const [open, setOpen] = useState(false)
  const [canInstall, setCanInstall] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!window.budgetlyDesktop) return
    let alive = true
    const check = () => {
      if (document.visibilityState === 'hidden') return
      fetchWindowsRelease().then(value => {
        if (alive && value && newerVersion(value.version, window.budgetlyDesktop.version || version) && sessionStorage.getItem(`budgetly-windows-update-dismissed-${value.version}`) !== 'yes') {
          setRelease(value); setOpen(true)
        }
      }).catch(() => {})
    }
    check()
    const timer = setInterval(check, 6 * 60 * 60 * 1000)
    window.addEventListener('focus', check)
    return () => { alive = false; clearInterval(timer); window.removeEventListener('focus', check) }
  }, [])
  const signedRelease = release?.signed === true
  useEffect(() => {
    if (!open || !signedRelease || !window.budgetlyDesktop?.canInstallUpdate) return
    let alive = true
    window.budgetlyDesktop.canInstallUpdate().then(available => {
      if (alive) setCanInstall(available === true)
    }).catch(() => {})
    return () => { alive = false }
  }, [open, signedRelease])
  const close = () => {
    if (installing) return
    if (release) sessionStorage.setItem(`budgetly-windows-update-dismissed-${release.version}`, 'yes')
    setOpen(false)
    setError('')
  }
  const install = async () => {
    setInstalling(true)
    setError('')
    try {
      const result = await window.budgetlyDesktop.installUpdate(release.version)
      if (!result?.installing) throw new Error(result?.error || 'Could not install the Windows update.')
    } catch (failure) {
      setError(failure.message)
      setInstalling(false)
    }
  }
  if (!window.budgetlyDesktop) return null
  const inlineUpdate = signedRelease && canInstall
  return <Modal open={open} onClose={close} title="A Windows update is ready" subtitle={release ? `Budgetly ${release.version}` : ''} layerClass="release-popup" slowEntrance
    footer={release && (inlineUpdate
      ? <button type="button" className="button primary release-action" disabled={installing} onClick={() => void install()}><Download size={18}/>{installing ? 'Preparing update…' : 'Update and restart'}</button>
      : <a className="button primary release-action" href={release.url} target="_blank" rel="noopener noreferrer" download onClick={close}><Download size={18}/>Download installer</a>)}>
    <p>{inlineUpdate ? 'Save any work first. Budgetly will verify the installer and reopen after the update.' : 'Open the installer to update your current Budgetly installation.'}</p>
    {release && !signedRelease && <p className="muted">Windows publisher verification is unavailable for this installer.</p>}
    {installing && <p role="status">Downloading and checking the update. Keep Budgetly open.</p>}
    {error && <p role="alert" className="form-error">{error}</p>}
    {release && <p className="muted">Version {release.version} · {(release.size / 1000000).toFixed(1)} MB</p>}
  </Modal>
}
