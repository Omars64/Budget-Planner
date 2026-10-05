import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import App, { LoginScreen } from './App'
import { GUEST_KEY, readGuest, setGuestActive } from './lib/guest'

vi.mock('./components/GoogleSignIn', () => ({ default: () => null }))
vi.mock('./components/AppShell', () => ({ default: ({ children }) => <main>{children}</main> }))
vi.mock('./pages/Overview', () => ({ default: () => <h2>Guest overview</h2> }))
vi.mock('./pages/Upcoming', () => ({ default: () => <h2>Protected upcoming content</h2> }))
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); setGuestActive(false); vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))) })
afterEach(() => { cleanup(); setGuestActive(false); vi.restoreAllMocks(); vi.unstubAllGlobals() })

test('skip sign-in animates the whole screen upward before entering Guest Mode', async () => {
  const enter = vi.fn()
  const { container } = render(<LoginScreen onLogin={vi.fn()} onGuest={enter}/>)
  fireEvent.click(screen.getByRole('button', { name: 'Continue without an account' }))
  expect(container.querySelector('.auth-screen')).toHaveClass('guest-entering')
  expect(enter).not.toHaveBeenCalled()
  await waitFor(() => expect(enter).toHaveBeenCalledTimes(1))
})
test('stored guest workspace resumes without authenticating or sending its records', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch')
  const data = readGuest(); setGuestActive(true)
  render(<MemoryRouter><App/></MemoryRouter>)
  await screen.findByRole('heading', { name: 'Guest overview' })
  expect(JSON.parse(localStorage.getItem(GUEST_KEY)).id).toBe(data.id)
  expect(fetch).not.toHaveBeenCalled()
})
test('direct navigation cannot mount a protected page as a guest', async () => {
  setGuestActive(true); readGuest()
  render(<MemoryRouter initialEntries={['/upcoming']}><App/></MemoryRouter>)
  await screen.findByText('Available with an account')
  expect(screen.queryByText('Protected upcoming content')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Sign in or create an account' }))
  await screen.findByRole('dialog', { name: 'Continue with an account' })
  fireEvent.click(screen.getByRole('button', { name: 'Continue', exact: true }))
  await screen.findByRole('button', { name: 'Back to guest workspace' })
})
