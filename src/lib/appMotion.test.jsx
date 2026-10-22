import { act, cleanup, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useContext } from 'react'
import { MotionConfigContext } from 'framer-motion'
import { deliberateTransition, readAppMotion, useAppMotion } from './appMotion'
import { saveComfort } from './comfort'
import MotionPreferences from '../components/MotionPreferences'

let media
beforeEach(() => {
  localStorage.clear()
  media = Object.assign(new window.EventTarget(), { matches: false })
  vi.stubGlobal('matchMedia', () => media)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); delete document.documentElement.dataset.motion })

test('OS reduced motion wins over app full, and off remains off', () => {
  media.matches = true
  saveComfort({ motion: 'full' })
  expect(readAppMotion()).toBe('reduced')
  saveComfort({ motion: 'off' })
  expect(readAppMotion()).toBe('off')
  expect(deliberateTransition('reduced', 'sheet').duration).toBe(0)
  expect(deliberateTransition('off').duration).toBe(0)
  expect(deliberateTransition('full', 'dialog').duration).toBe(.32)
  expect(deliberateTransition('full', 'popup').duration).toBe(1.1)
  expect(deliberateTransition('reduced', 'popup').duration).toBe(0)
  expect(deliberateTransition('off', 'popup').duration).toBe(0)
})

test('hook reacts to app, OS and cross-tab changes and removes listeners', () => {
  const remove = vi.spyOn(media, 'removeEventListener')
  const hook = renderHook(useAppMotion)
  expect(hook.result.current).toBe('full')
  act(() => saveComfort({ motion: 'reduced' }))
  expect(hook.result.current).toBe('reduced')
  act(() => saveComfort({ motion: 'full' }))
  act(() => { media.matches = true; media.dispatchEvent(new Event('change')) })
  expect(hook.result.current).toBe('reduced')
  act(() => { localStorage.setItem('budgetly:comfort', JSON.stringify({ motion: 'off' })); window.dispatchEvent(new Event('storage')) })
  expect(hook.result.current).toBe('off')
  hook.unmount()
  expect(remove).toHaveBeenCalledWith('change', expect.any(Function))
})

test('root disables Framer layout and JS animations for both reduced sources', () => {
  function Value() { const config = useContext(MotionConfigContext); return <output>{`${config.skipAnimations}:${config.reducedMotion}`}</output> }
  render(<MotionPreferences><Value/></MotionPreferences>)
  expect(screen.getByText('false:never')).toBeInTheDocument()
  act(() => saveComfort({ motion: 'reduced' }))
  expect(screen.getByText('true:always')).toBeInTheDocument()
  act(() => { media.matches = true; saveComfort({ motion: 'full' }) })
  expect(screen.getByText('true:always')).toBeInTheDocument()
  expect(document.documentElement.dataset.motion).toBe('reduced')
})
