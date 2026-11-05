import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { fetchWindowsRelease } from '../lib/appUpdates'

export default function WindowsReleaseDownload({ compact = false }) {
  const [release, setRelease] = useState(null)
  useEffect(() => {
    const controller = new AbortController()
    fetchWindowsRelease(controller.signal).then(setRelease).catch(() => {})
    return () => controller.abort()
  }, [])
  if (!release) return null
  return <a className={compact ? 'welcome-install' : 'button primary'} href={release.url} target="_blank" rel="noopener noreferrer" download>
    <Download size={17} aria-hidden="true"/> Download for Windows{compact ? '' : ` · v${release.version}`}
  </a>
}
