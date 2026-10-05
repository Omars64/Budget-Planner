import { useEffect, useState } from 'react'
import { guestHasRecords } from '../lib/guest'
import SettingsSection from './SettingsSection'

export default function GuestRecords() {
  const [available, setAvailable] = useState(false)
  useEffect(() => {
    const check = () => { try { setAvailable(guestHasRecords()) } catch { setAvailable(false) } }
    check(); window.addEventListener('budgetly:guest-changed', check); window.addEventListener('storage', check)
    return () => { window.removeEventListener('budgetly:guest-changed', check); window.removeEventListener('storage', check) }
  }, [])
  return available ? <SettingsSection title="Guest records on this device"><button className="button ghost" onClick={() => window.dispatchEvent(new Event('budgetly:guest-import'))}>Review and import guest records</button></SettingsSection> : null
}
