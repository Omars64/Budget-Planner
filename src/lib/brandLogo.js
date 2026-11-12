import { Capacitor, registerPlugin } from '@capacitor/core'
import { paletteKey } from './colorPalettes'

const LauncherIcon = registerPlugin('BudgetlyLauncherIcon')

export function brandLogoUrl(palette, style) {
  return style === 'legacy' ? '/flowbudget-logo-legacy.png' : `/brand/wallet-${paletteKey(palette)}.png`
}

export function setBrandFavicon(palette, style) {
  document.querySelector('link[rel="icon"]')?.setAttribute('href', brandLogoUrl(palette, style))
}

export function applyInstalledBrandIcon(palette) {
  const key = paletteKey(palette)
  window.budgetlyDesktop?.setPaletteIcon?.(key)
  if (Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('BudgetlyLauncherIcon')) {
    void LauncherIcon.setPalette({ palette:key }).catch(() => {
      // Launcher support can vary independently of the in-app logo.
    })
  }
}
