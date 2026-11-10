import { readDeviceAppearance } from '../lib/appearance'
import { brandLogoUrl } from '../lib/brandLogo'

export default function BrandLogo({ className = '', style = 'current', palette = readDeviceAppearance().color_palette, alt = 'Budgetly' }) {
  return <img className={`brand-logo ${className}`} src={brandLogoUrl(palette, style)} alt={alt} width="40" height="40" />
}
