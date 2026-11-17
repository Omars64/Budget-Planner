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

test('an expired in-app request shows one five-second notice and opens sign-in', async () => {
  render(<MemoryRouter><App/></MemoryRouter>)
  await tick(0)
  await act(() => vi.dynamicImportSettled())
  fireEvent.click(screen.getByRole('button', { name: 'Refresh workspace' }))
  await tick(0)
  expect(screen.getByRole('alert')).toHaveTextContent('Session expired. Logging out now…')
  expect(screen.queryByRole('button', { name: 'Refresh workspace' })).toBeNull()
  await tick(4999)
  expect(screen.getByRole('alert')).toBeInTheDocument()
  expect(auth.token).toBe('old-session')
  await tick(1)
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getByRole('dialog', { name: 'Your Budgetly account' })).toBeInTheDocument()
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
  expect(screen.getByRole('button', { name: 'Refresh workspace' })).toBeInTheDocument()
})

test('an expired remembered session on startup uses the same notice and sign-in', async () => {
  fetchMock.mockImplementationOnce(async () => expired())
  render(<MemoryRouter><App/></MemoryRouter>)
  await tick(0)
  expect(screen.getByRole('alert')).toHaveTextContent('Session expired. Logging out now…')
  await tick(5000)
  expect(screen.getByRole('dialog', { name: 'Your Budgetly account' })).toBeInTheDocument()
  expect(auth.token).toBe('')
})
