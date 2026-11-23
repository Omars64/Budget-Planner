import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import App from './App'
import { api, auth } from './lib/api'
import { clearOfflineCache } from './lib/offlineStore'

vi.mock('./lib/offlineStore', async importOriginal => ({
  ...await importOriginal(), clearOfflineCache: vi.fn(async () => {}),
}))
vi.mock('./lib/offlineSync', async importOriginal => ({
  ...await importOriginal(), rememberOfflineSession: vi.fn(async () => {}), restoreOfflineSession: vi.fn(async () => null),
  syncOfflineQueue: vi.fn(async () => {}),
}))
vi.mock('./components/AppShell', () => ({ default: ({ children }) => <main>{children}</main> }))
vi.mock('./components/Experience', () => ({ default: () => null }))
vi.mock('./components/GoogleSignIn', () => ({ default: () => null }))
vi.mock('./pages/Overview', () => ({ default: () => <button onClick={() => {
  void api('/api/dashboard').catch(() => {})
  void api('/api/transactions').catch(() => {})
}}>Refresh workspace</button> }))

const user = { id: 17, username: 'Test user', role: 'user' }
const expired = () => globalThis.Response.json({ detail: 'Session expired' }, { status: 401 })
const tick = ms => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
let fetchMock

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  sessionStorage.clear()
  localStorage.clear()
  auth.setRemembered(true)
  auth.token = 'old-session'
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
  fetchMock = vi.fn(async (url) => {
    const path = new URL(url, 'http://localhost').pathname
    if (path === '/api/auth/me') return globalThis.Response.json(user)
    if (path === '/api/auth/login') return globalThis.Response.json({ user, token: 'fresh-session' })
    if (path === '/api/settings') return globalThis.Response.json({ currency: 'KWD' })
    if (path === '/api/dashboard' || path === '/api/transactions') return expired()
    return globalThis.Response.json([])
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  auth.clear()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

test('an expired in-app request clears the session immediately and opens sign-in', async () => {
  render(<MemoryRouter><App/></MemoryRouter>)
  await tick(0)
  await act(() => vi.dynamicImportSettled())
  fireEvent.click(screen.getByRole('button', { name: 'Refresh workspace' }))
  await tick(0)
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Refresh workspace' })).toBeNull()
  expect(screen.getByRole('dialog', { name: 'Your Budgetly account' })).toHaveTextContent('Your session expired. Sign in again to continue.')
  expect(screen.getByLabelText('Email')).toBeInTheDocument()
  expect(auth.token).toBe('')
  expect(localStorage.getItem('flowbudget_token')).toBeNull()
  expect(clearOfflineCache).toHaveBeenCalledExactlyOnceWith('17')
  expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/api/account/signout'))).toBe(false)

  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'test@example.test' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'synthetic-password' } })
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sign in', exact: true }))
  await tick(0)
  expect(auth.token).toBe('fresh-session')
  expect(localStorage.getItem('budgetly:session-ended')).toBeNull()
  expect(screen.getByRole('button', { name: 'Refresh workspace' })).toBeInTheDocument()
})

test('the sign-in message persists across relaunches after expiry during startup', async () => {
  fetchMock.mockImplementationOnce(async () => expired())
  const view = render(<MemoryRouter><App/></MemoryRouter>)
  await tick(0)
  expect(auth.token).toBe('')
  view.unmount()
  render(<MemoryRouter><App/></MemoryRouter>)
  await tick(0)
  expect(screen.getByRole('dialog')).toHaveTextContent('Your session expired. Sign in again to continue.')
})

test('resuming after the signed session deadline signs out even when offline', async () => {
  const issuedAt = Math.floor(Date.now() / 1000)
  const timestamp = btoa(String.fromCharCode(issuedAt >>> 24, (issuedAt >>> 16) & 255, (issuedAt >>> 8) & 255, issuedAt & 255))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  auth.token = `.payload.${timestamp}.signature`
  render(<MemoryRouter><App/></MemoryRouter>)
  await tick(0)
  await act(() => vi.dynamicImportSettled())
  expect(screen.getByRole('button', { name: 'Refresh workspace' })).toBeInTheDocument()
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  vi.setSystemTime((issuedAt + 86400) * 1000 + 1000)
  fireEvent(window, new Event('pageshow'))
  expect(auth.token).toBe('')
  expect(screen.getByRole('dialog')).toHaveTextContent('Your session expired. Sign in again to continue.')
  vi.restoreAllMocks()
})
