import { paletteKey } from './colorPalettes'

export function brandLogoUrl(palette, style) {
  return style === 'legacy' ? '/flowbudget-logo-legacy.png' : `/brand/wallet-${paletteKey(palette)}.svg`
}
