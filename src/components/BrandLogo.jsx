import { readDeviceAppearance } from '../lib/appearance'
import { brandLogoUrl } from '../lib/brandLogo'

export default function BrandLogo({ className = '', style = 'current', palette, alt = 'Budgetly' }) {
  if (palette === undefined) {
    const appearance = readDeviceAppearance()
    palette = appearance.pinned_icon_palette ?? appearance.color_palette
  }
  return <img className={`brand-logo ${className}`} src={brandLogoUrl(palette, style)} alt={alt} width="40" height="40" />
}
