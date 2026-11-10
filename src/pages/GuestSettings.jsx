import PaletteSettings from '../components/PaletteSettings'
import SeasonalSettings from '../components/SeasonalSettings'
import WelcomeAnimationSettings from '../components/WelcomeAnimationSettings'
import LogoSettings from '../components/LogoSettings'
import AndroidAppSettings from '../components/AndroidAppSettings'
import { Download, LogIn, Trash2 } from 'lucide-react'
import { useApp } from '../App'
import { clearGuest, guestCsv, GUEST_KEY, GUEST_IMPORT_KEY } from '../lib/guest'
import { saveDownload } from '../lib/download'
import SettingsSection from '../components/SettingsSection'
import SettingsWorkspace from '../components/SettingsWorkspace'
import CurrencyConfiguration from '../components/CurrencyConfiguration'
import ComfortSettings from '../components/ComfortSettings'
import AppearancePreferences from '../components/AppearancePreferences'
import WorkspacePreferences from '../components/WorkspacePreferences'
import UpdateNotificationPreference from '../components/UpdateNotificationPreference'

export default function GuestSettings() {
  const { refresh, notify, confirm, requestSignIn } = useApp()
  const exportData = async format => {
    try {
      const raw = format === 'csv' ? guestCsv() : localStorage.getItem(GUEST_KEY)
      await saveDownload(new Blob([raw || '{}'], { type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json' }), `Budgetly-guest-${new Date().toISOString().slice(0, 10)}.${format}`)
      notify('Guest records exported')
    } catch (error) { notify(error.message, 'error') }
  }
  return <SettingsWorkspace guest>
    <PaletteSettings settingsId="appearance" settingsOrder={0}/>
    <WelcomeAnimationSettings settingsId="appearance"/>
    <LogoSettings settingsId="appearance"/>
    <SettingsSection title="Guest workspace"><p>Stored only on this device. Clearing browser storage or uninstalling can remove these records.</p><button className="button primary" onClick={() => requestSignIn('cloud storage and account features')}><LogIn size={18}/>Sign in or create an account</button></SettingsSection>
    <SeasonalSettings settingsId="appearance"/><SettingsSection title="Personal preferences"><h4>Motion & feedback</h4><ComfortSettings/><AppearancePreferences guest/></SettingsSection>
    <CurrencyConfiguration settingsId="money"/>
    <AndroidAppSettings settingsId="android"/>
    <SettingsSection title="Transaction entry"><WorkspacePreferences/></SettingsSection>
    <SettingsSection title="Export and local data"><div className="button-row"><button className="button ghost" onClick={() => exportData('csv')}><Download size={17}/>CSV transactions</button><button className="button ghost" onClick={() => exportData('json')}><Download size={17}/>Full local copy</button></div><button className="button danger" onClick={async () => { if (localStorage.getItem(GUEST_IMPORT_KEY)) { notify('Finish the pending import before clearing guest records.','error'); return } if (await confirm('Permanently clear guest records on this device? Export them first. There is no deleted-item recovery in Guest Mode.')) { clearGuest(); refresh(); notify('Guest records cleared') } }}><Trash2 size={17}/>Clear guest records</button></SettingsSection>
    <SettingsSection title="Notifications"><UpdateNotificationPreference notify={notify}/></SettingsSection>
    <SettingsSection title="Account features"><p>Sign in for security, biometrics, reminders, deleted-item recovery and cloud backups.</p><button className="button ghost" onClick={() => requestSignIn('account features')}>Continue with an account</button></SettingsSection>
  </SettingsWorkspace>
}
