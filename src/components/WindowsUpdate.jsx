import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import Modal from './Modal'
import { fetchWindowsRelease, newerVersion } from '../lib/appUpdates'
import { version } from '../../package.json'

export default function WindowsUpdate() {
  const [release, setRelease] = useState(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!window.budgetlyDesktop) return
    let alive = true
    const check = () => {
      if (document.visibilityState === 'hidden') return
      fetchWindowsRelease().then(value => {
        if (alive && value && newerVersion(value.version, version) && sessionStorage.getItem(`budgetly-windows-update-dismissed-${value.version}`) !== 'yes') {
          setRelease(value); setOpen(true)
        }
      }).catch(() => {})
    }
    check()
    const timer = setInterval(check, 6 * 60 * 60 * 1000)
    window.addEventListener('focus', check)
    return () => { alive = false; clearInterval(timer); window.removeEventListener('focus', check) }
  }, [])
  const close = () => { if (release) sessionStorage.setItem(`budgetly-windows-update-dismissed-${release.version}`, 'yes'); setOpen(false) }
  if (!window.budgetlyDesktop) return null
  return <Modal open={open} onClose={close} title="A Windows update is ready" subtitle={release ? `Budgetly ${release.version}` : ''} layerClass="release-popup" slowEntrance
    footer={release && <a className="button primary release-action" href={release.url} target="_blank" rel="noopener noreferrer" download onClick={close}><Download size={18}/>Download installer</a>}>
    <p>Install this version over Budgetly to update the desktop app. Your records stay in your account.</p>
    {release && <p className="muted">Version {release.version} · {(release.size / 1000000).toFixed(1)} MB</p>}
  </Modal>
}
