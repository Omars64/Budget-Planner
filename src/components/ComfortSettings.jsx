import { useState } from 'react'
import { readComfort, saveComfort } from '../lib/comfort'
import { Capacitor } from '@capacitor/core'

export default function ComfortSettings() {
  const [value, setValue] = useState(readComfort)
  const [error, setError] = useState('')
  const update = patch => { try { const next = {...value,...patch}; saveComfort(next); setValue(next); setError('') } catch { setError('Allow device storage to save this preference.') } }
  return <div className="stack gap-16">
    <label className="field"><span>Motion on this device</span><select value={value.motion} onChange={e => update({motion:e.target.value})}><option value="system">Match device</option><option value="full">Full</option><option value="reduced">Reduced</option><option value="off">Off</option></select></label>
    {Capacitor.isNativePlatform() && <label className="check-row"><input type="checkbox" checked={value.haptics} onChange={e => update({haptics:e.target.checked})}/><span>Light vibration after saving</span></label>}
    {error && <p role="alert" className="form-error">{error}</p>}
  </div>
}
