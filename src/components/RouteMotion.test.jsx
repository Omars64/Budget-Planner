import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import RouteMotion from './RouteMotion'
import { saveComfort } from '../lib/comfort'
import ScrollMemory from './ScrollMemory'
import { readView, writeView } from '../lib/viewState'

let navigate, animations, mounts
const originalAnimate = window.HTMLElement.prototype.animate
function Navigation() { navigate = useNavigate(); return null }
function Page() {
  const location = useLocation()
  useEffect(() => { mounts++ }, [])
  return <><p>{location.pathname}</p><input aria-label="Draft" defaultValue=""/></>
}
function Shell({ children, rememberScroll }) {
  const location = useLocation()
  return <>{rememberScroll && <ScrollMemory userId="motion"/>}<div className="page-wrap" key={location.pathname}>{children}</div></>
}
function setup(rememberScroll = false) {
  return render(<MemoryRouter><Navigation/><RouteMotion>{() => <Shell rememberScroll={rememberScroll}><Routes><Route path="*" element={<Page/>}/></Routes></Shell>}</RouteMotion></MemoryRouter>)
}
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); animations = []; mounts = 0
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  window.HTMLElement.prototype.animate = vi.fn((frames, options) => {
    let finish
    const animation = { frames, options, finished: new Promise(resolve => { finish = resolve }), cancel: vi.fn(), finish: () => finish() }
    animations.push(animation)
    return animation
  })
})
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals()
  if (originalAnimate) window.HTMLElement.prototype.animate = originalAnimate
  else delete window.HTMLElement.prototype.animate
})

test('the destination mounts immediately, enters directionally, and POP reverses', () => {
  setup()
  fireEvent.change(screen.getByLabelText('Draft'), { target: { value: 'Unsent' } })
  act(() => navigate('/wallets'))
  expect(screen.getAllByLabelText('Draft')).toHaveLength(1)
  expect(screen.getByText('/wallets')).toBeInTheDocument()
  expect(mounts).toBe(2)
  expect(animations[0].frames[0].clipPath).toBe('inset(0 0 0 1%)')
  expect(animations[0].options.duration).toBe(160)
  expect(animations.flatMap(animation => animation.frames).every(frame => !('transform' in frame))).toBe(true)
  act(() => navigate(-1))
  expect(animations[1].frames[0].clipPath).toBe('inset(0 1% 0 0)')
})

test('query, hash, state and comfort changes preserve the current form and do not animate or scroll', () => {
  const scroll = vi.spyOn(window, 'scrollTo')
  setup()
  const draft = screen.getByLabelText('Draft')
  fireEvent.change(draft, { target: { value: 'Unsent' } })
  act(() => navigate('/?category=2#details', { state: { setting: true } }))
  act(() => saveComfort({ motion: 'reduced' }))
  expect(screen.getByLabelText('Draft')).toBe(draft)
  expect(draft).toHaveValue('Unsent')
  expect(mounts).toBe(1)
  expect(animations).toHaveLength(0)
  expect(scroll).not.toHaveBeenCalled()
})

test('rapid navigation cancels stale animations and motion off keeps the current screen', async () => {
  setup()
  act(() => navigate('/wallets'))
  act(() => navigate('/notes'))
  expect(animations[0].cancel).toHaveBeenCalled()
  await act(async () => animations[0].finish())
  expect(screen.getByText('/notes')).toBeInTheDocument()
  act(() => saveComfort({ motion: 'off' }))
  expect(animations[1].cancel).toHaveBeenCalled()
  expect(screen.getByText('/notes')).toBeInTheDocument()
  expect(screen.getAllByLabelText('Draft')).toHaveLength(1)
})

test('scroll memory saves the outgoing page and restores its destination on navigation', () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(({ top }) => {
    Object.defineProperty(window, 'scrollY', { configurable: true, value: top })
  })
  writeView('scroll:motion:/wallets', 280)
  setup(true)
  Object.defineProperty(window, 'scrollY', { configurable: true, value: 640 })
  fireEvent.scroll(window)
  scroll.mockClear()
  act(() => navigate('/wallets'))
  expect(readView('scroll:motion:/', 0)).toBe(640)
  expect(scroll).toHaveBeenLastCalledWith({ top: 280, behavior: 'instant' })
  expect(window.scrollY).toBe(280)
})

test('back navigation replaces the destination animation without duplicating the page', () => {
  setup()
  act(() => navigate('/wallets'))
  act(() => navigate(-1))
  expect(animations[0].cancel).toHaveBeenCalled()
  expect(screen.getByText('/')).toBeInTheDocument()
  expect(screen.getAllByLabelText('Draft')).toHaveLength(1)
  expect(mounts).toBe(3)
})
