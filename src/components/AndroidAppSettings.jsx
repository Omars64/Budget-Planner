import SettingsSection from './SettingsSection'
import AndroidReleaseDownload from './AndroidReleaseDownload'

export default function AndroidAppSettings() {
  return <SettingsSection title="Android app" heading="Android version & release notes"><AndroidReleaseDownload showDownload={false}/></SettingsSection>
}
