import { useEffect, useState } from 'react'
import { BellRing, RefreshCw } from 'lucide-react'
import { api } from '../lib/api'
import { syncUpdatePush } from '../lib/updatePush'
import { notificationSettingsChangedEvent, updateNotificationsEnabled } from '../lib/notificationSettings'

export default function UpdateDelivery() {
  const [devices, setDevices] = useState([])
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [enabled, setEnabled] = useState(updateNotificationsEnabled)
  useEffect(() => {
    const changed = () => setEnabled(updateNotificationsEnabled())
    window.addEventListener(notificationSettingsChangedEvent, changed)
    return () => window.removeEventListener(notificationSettingsChangedEvent, changed)
  }, [])
  async function refresh(register = false) {
    if (busy) return
    setBusy(true); setMessage('')
    try {
      if (register) {
        const result = await syncUpdatePush(updateNotificationsEnabled())
        if (!result.enabled) throw new Error(result.configured === false ? 'Closed-app sender is not configured.' : 'Allow device notifications, enable update or scheduled-entry alerts, and save notifications first.')
      }
      const result = await api('/api/app-updates/push-devices')
      setDevices(result.devices)
      setSelected(previous => result.devices.some(device => device.id === previous) ? previous : result.devices[0]?.id || '')
      if (!result.devices.length) setMessage('No registered devices. Enable update or scheduled-entry alerts and save notifications on this device.')
    } catch (error) { setMessage(error.message) }
    finally { setBusy(false) }
  }
  async function test() {
    if (busy || !selected || !enabled) return
    setBusy(true); setMessage('')
    try { const result = await api(`/api/app-updates/push-device/${selected}/test`, { method:'POST' }); setMessage(result.message) }
    catch (error) { setMessage(error.message) }
    finally { setBusy(false) }
  }
  return <details className="update-delivery" onToggle={event => { if (event.currentTarget.open) void refresh() }}>
    <summary>Update delivery</summary>
    <div className="stack gap-12">
      {!!devices.length && <label className="field"><span>Registered device</span><select value={selected} disabled={busy} onChange={event => setSelected(event.target.value)}>{devices.map((device,index) => <option key={device.id} value={device.id}>{device.platform === 'android' ? 'Android' : 'Browser'} {index+1} · v{device.installed_version}</option>)}</select></label>}
      <div className="button-row"><button type="button" className="button ghost" disabled={busy} onClick={() => void refresh(true)}><RefreshCw size={17}/>Reconnect this device</button><button type="button" className="button ghost" disabled={busy || !selected || !enabled} onClick={() => void test()}><BellRing size={17}/>Test notification</button></div>
      {message && <p role="status" className="muted">{message}</p>}
    </div>
  </details>
}
