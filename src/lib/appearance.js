import { useLayoutEffect } from 'react'

const storageKey = 'budgetly_device_appearance'
const fonts = { system:'system-ui, sans-serif', arial:'Arial, sans-serif', georgia:'Georgia, serif', verdana:'Verdana, sans-serif' }
const colours = { ink:'#172c38', charcoal:'#242424', forest:'#193c32' }

function preferences(value = {}) {
  return {
    theme:['light','dark','system'].includes(value?.theme) ? value.theme : 'light',
    font_family:Object.hasOwn(fonts,value?.font_family) ? value.font_family : 'system',
    text_color:Object.hasOwn(colours,value?.text_color) ? value.text_color : 'ink',
    accent_color:/^#[0-9a-f]{6}$/i.test(value?.accent_color || '') ? value.accent_color : '#0a4173',
  }
}

export function readDeviceAppearance() {
  try { return preferences(JSON.parse(localStorage.getItem(storageKey))) }
  catch { return preferences() }
}

export function applyAppearance(value, systemDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
  const prefs = preferences(value)
  const root = document.documentElement
  const dark = prefs.theme === 'dark' || (prefs.theme === 'system' && systemDark)
  root.dataset.theme = dark ? 'dark' : 'light'
  root.style.setProperty('--app-font',fonts[prefs.font_family])
  root.style.setProperty('--text',dark ? '#e4e8e7' : colours[prefs.text_color])
  const accent = prefs.accent_color
  const bytes = accent.match(/[0-9a-f]{2}/gi).map(value=>parseInt(value,16))
  const channels = bytes.map(value=>value/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4)
  const luminance = channels[0]*.2126+channels[1]*.7152+channels[2]*.0722
  root.style.setProperty('--accent-contrast',luminance > .179 ? '#172c38' : '#fff')
  root.style.setProperty('--accent-2',accent.toLowerCase()==='#0a4173' ? '#2f6690' : accent)
  root.style.setProperty('--accent',accent)
  root.style.setProperty('--accent-rgb',bytes.join(', '))
  root.style.setProperty('--accent-soft',`rgba(${bytes.join(', ')}, .10)`)
}

export function useAppearance(settings) {
  useLayoutEffect(()=>{
    const prefs = preferences(settings)
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const update = () => applyAppearance(prefs,media.matches)
    update()
    // Persist only visual preferences, so signed-out screens can use them too.
    try { localStorage.setItem(storageKey,JSON.stringify(prefs)) } catch { /* Storage is optional. */ }
    media.addEventListener('change',update)
    return () => media.removeEventListener('change',update)
  },[settings.theme,settings.font_family,settings.text_color,settings.accent_color])
}
