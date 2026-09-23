import { useEffect, useState } from 'react'

export default function ConnectionStatus() {
  const [offline, setOffline] = useState(() => navigator.onLine === false)
  useEffect(() => {
    const update = () => setOffline(navigator.onLine === false)
    window.addEventListener('online', update); window.addEventListener('offline', update)
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) }
  }, [])
  return offline ? <div className="connection-status" role="status">Offline. Displayed records may be out of date. Keep your draft and retry when connected.</div> : null
}
