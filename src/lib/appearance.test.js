import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { applyAppearance, readDeviceAppearance, useAppearance } from './appearance'

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
  expect(readDeviceAppearance()).toEqual({theme:'dark',accent_color:'#123456',font_family:'system',text_color:'ink'})
  document.documentElement.dataset.theme='light'
  applyAppearance(readDeviceAppearance())
  expect(document.documentElement.dataset.theme).toBe('dark')
  expect(localStorage.getItem('budgetly_device_appearance')).not.toContain('email')
})

it('updates for another account and tracks device theme changes',()=>{
  const {rerender}=renderHook(({theme})=>useAppearance({theme}),{initialProps:{theme:'dark'}})
  rerender({theme:'light'})
  expect(document.documentElement.dataset.theme).toBe('light')
  rerender({theme:'system'})
  act(()=>{media.matches=true;media.addEventListener.mock.calls.at(-1)[1]()})
  expect(document.documentElement.dataset.theme).toBe('dark')
})

it('falls back safely if cached appearance is malformed',()=>{
  localStorage.setItem('budgetly_device_appearance','invalid json')
  expect(readDeviceAppearance().theme).toBe('light')
  localStorage.setItem('budgetly_device_appearance',JSON.stringify({theme:'bad',accent_color:'bad'}))
  expect(readDeviceAppearance().accent_color).toBe('#0a4173')
})
