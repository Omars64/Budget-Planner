import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { applyAppearance, readDeviceAppearance, useAppearance } from './appearance'
import { colorPalettes } from './colorPalettes'

let media
beforeEach(()=>{
  localStorage.clear()
  media={matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()}
  vi.stubGlobal('matchMedia',vi.fn(()=>media))
})
afterEach(()=>{cleanup();vi.unstubAllGlobals()})

it('retains visual preferences after logout/unmount and restores them on a fresh load',()=>{
  const {unmount}=renderHook(()=>useAppearance({theme:'dark',accent_color:'#123456',email:'not-stored@example.com'}))
  unmount()
  expect(document.documentElement.dataset.theme).toBe('dark')
  expect(readDeviceAppearance()).toEqual({theme:'dark',color_palette:'navy',pinned_icon_palette:null,miami_wallpaper:true,font_family:'system',text_color:'ink'})
  expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#8fd8f5')
  document.documentElement.dataset.theme='light'
  applyAppearance(readDeviceAppearance())
  expect(document.documentElement.dataset.theme).toBe('dark')
  expect(localStorage.getItem('budgetly_device_appearance')).not.toContain('email')
})

it('tracks changes to the local appearance and system theme',()=>{
  const {rerender}=renderHook(({theme})=>useAppearance({theme}),{initialProps:{theme:'dark'}})
  rerender({theme:'light'})
  expect(document.documentElement.dataset.theme).toBe('light')
  rerender({theme:'system'})
  act(()=>{media.matches=true;media.addEventListener.mock.calls.at(-1)[1]()})
  expect(document.documentElement.dataset.theme).toBe('dark')
})

it('applies the Miami contrast and remembers its wallpaper choice without replacing the preferred appearance',()=>{
  const root = document.documentElement
  const {rerender}=renderHook(({palette,wallpaper})=>useAppearance({theme:'light',color_palette:palette,miami_wallpaper:wallpaper}),{initialProps:{palette:'miami',wallpaper:true}})
  expect(root.dataset.theme).toBe('dark')
  expect(root).toHaveAttribute('data-miami-wallpaper')
  expect(root.style.getPropertyValue('--palette-role-balance')).toBe('#ffbb8c')
  rerender({palette:'miami',wallpaper:false})
  expect(root).not.toHaveAttribute('data-miami-wallpaper')
  expect(readDeviceAppearance()).toMatchObject({theme:'light',color_palette:'miami',miami_wallpaper:false})
  rerender({palette:'navy',wallpaper:false})
  expect(root.dataset.theme).toBe('light')
})

it('falls back safely if cached appearance is malformed',()=>{
  localStorage.setItem('budgetly_device_appearance','invalid json')
  expect(readDeviceAppearance().theme).toBe('light')
  localStorage.setItem('budgetly_device_appearance',JSON.stringify({theme:'bad',accent_color:'bad',pinned_icon_palette:'bad'}))
  expect(readDeviceAppearance().theme).toBe('light')
  expect(readDeviceAppearance().color_palette).toBe('navy')
  expect(readDeviceAppearance().pinned_icon_palette).toBeNull()
})

it('persists the pinned icon independently of the current theme',()=>{
  const {rerender,unmount} = renderHook(
    ({palette,pinned}) => useAppearance({color_palette:palette},pinned),
    {initialProps:{palette:'burgundy',pinned:'burgundy'}},
  )
  rerender({palette:'pine',pinned:'burgundy'})
  expect(readDeviceAppearance()).toMatchObject({color_palette:'pine',pinned_icon_palette:'burgundy'})
  rerender({palette:'pine',pinned:null})
  unmount()
  expect(readDeviceAppearance()).toMatchObject({color_palette:'pine',pinned_icon_palette:null})
})

it('keeps the personal palette in a shared workspace and on the welcome screen',()=>{
  const {unmount}=renderHook(()=>useAppearance({theme:'dark',color_palette:'burgundy',accent_color:'#267d75'}))
  expect(document.documentElement.style.getPropertyValue('--palette-bright')).toBe('#e7be79')
  expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#e7be79')
  unmount()
  applyAppearance(readDeviceAppearance())
  expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#e7be79')
})

it('applies the approved surfaces and default wallet card in both modes and clears them on a legacy palette',()=>{
  const { style } = document.documentElement
  for (const key of ['porcelain','voltage','lagoon','ultramarine','lilac','papaya']) {
    const palette = colorPalettes[key]
    for (const theme of ['light','dark']) {
      const colors = palette[`${theme}Mode`]
      applyAppearance({theme,color_palette:key})
      expect(style.getPropertyValue('--palette-role-header')).toBe(colors.bar)
      expect(style.getPropertyValue('--palette-role-page')).toBe(colors.page)
      expect(style.getPropertyValue('--palette-role-balance')).toBe(colors.balance)
      expect(style.getPropertyValue('--accent-contrast')).toBe(colors.actionInk)
      expect(style.getPropertyValue('--palette-card-ink')).toBe(palette.card.ink)
    }
  }
  applyAppearance({theme:'dark',color_palette:'aubergine'})
  expect(style.getPropertyValue('--palette-role-balance')).toBe('')
  expect(style.getPropertyValue('--palette-card-ink')).toBe('')
  expect(style.getPropertyValue('--palette-deep')).toBe('#0b1830')
  applyAppearance({theme:'dark',color_palette:'navy'})
  expect(style.getPropertyValue('--palette-deep')).toBe('#1c3a59')
})
