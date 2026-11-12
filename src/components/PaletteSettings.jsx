import { Check } from 'lucide-react'
import { useApp } from '../App'
import { colorPalettes, paletteKey } from '../lib/colorPalettes'
import SettingsSection from './SettingsSection'
import AppSelect from './AppSelect'

export default function PaletteSettings() {
  const { settings, setDeviceAppearance } = useApp()
  const current = paletteKey(settings.color_palette)
  return <div className="palette-settings">
    <label className="field palette-appearance"><span>Appearance on this device</span><AppSelect aria-label="Appearance" value={settings.theme} onChange={event => setDeviceAppearance({ theme:event.target.value })}><option value="light">Light mode</option><option value="dark">Dark mode</option><option value="system">Match device</option></AppSelect></label>
    <SettingsSection title="Color palette">
    <div className="palette-picker" role="group" aria-label="Color palette">
      {Object.entries(colorPalettes).map(([key,{name,deep,light,bright,lightMode}]) =>
        <button key={key} type="button" className="palette-choice" aria-pressed={current === key} onClick={() => current !== key && setDeviceAppearance({ color_palette:key })}>
          <span className="palette-samples" aria-hidden="true"><i style={{background:lightMode?.bar ?? deep}}/><i style={{background:lightMode?.balance ?? light}}/><i style={{background:lightMode?.action ?? bright}}/></span>
          <strong>{name}</strong>{current === key && <Check size={17} aria-hidden="true"/>}
        </button>)}
    </div>
    </SettingsSection>
  </div>
}
