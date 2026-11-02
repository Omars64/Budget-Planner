import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import WelcomeScreen from './WelcomeScreen'
import WelcomeAnimationSettings from './WelcomeAnimationSettings'
import { LoginScreen } from '../App'
import { readWelcomeSpeed, saveWelcomeSpeed } from '../lib/welcomeAnimation'

vi.mock('./GoogleSignIn', () => ({ default: () => <button type="button">Continue with Google</button> }))
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))) })
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
const auth = (mode, busy) => <LoginScreen initialMode={mode} embedded onLogin={vi.fn()} onBusyChange={busy}/>

test('first visit requires an explicit guest choice and opens the existing complete authentication flow', async () => {
  const enter = vi.fn()
  const { container } = render(<WelcomeScreen onGuest={enter} renderAuth={auth}/>)
  expect(enter).not.toHaveBeenCalled()
  expect(container.querySelector('.auth-brand')).toBeNull()
  expect(screen.getByText('Budgetly by Omar Solanki')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Sign in', exact: true }))
  const dialog = screen.getByRole('dialog')
  expect(within(dialog).getByLabelText('Email')).toBeInTheDocument()
  expect(within(dialog).getByLabelText('Password')).toHaveAttribute('type', 'password')
  expect(within(dialog).getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Forgot password?' }))
  expect(within(dialog).getByRole('button', { name: 'Send reset link' })).toBeInTheDocument()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close dialog' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: 'Create an account', exact: true }))
  expect(screen.getByLabelText('Username')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Continue to email verification' })).toBeInTheDocument()
})

test('guest opening failure remains actionable and never clears local records', async () => {
  localStorage.setItem('preserved-record', 'untouched')
  const enter = vi.fn().mockRejectedValue(new Error('Storage unavailable'))
  render(<WelcomeScreen onGuest={enter} renderAuth={auth}/>)
  fireEvent.click(screen.getByRole('button', { name: 'Try without an account' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Storage unavailable')
  expect(enter).toHaveBeenCalledTimes(1)
  expect(localStorage.getItem('preserved-record')).toBe('untouched')
  expect(screen.getByRole('button', { name: 'Try without an account' })).toBeEnabled()
})

test('speed saves immediately from its own dropdown, survives remount, and respects reduced motion', () => {
  const first = render(<WelcomeAnimationSettings/>)
  fireEvent.click(screen.getByText('Greeting animation speed'))
  fireEvent.change(screen.getByLabelText('Animation speed'), { target: { value: '6' } })
  expect(readWelcomeSpeed()).toBe(6)
  expect(screen.getByRole('status')).toHaveTextContent('saved on this device')
  first.unmount()
  localStorage.setItem('budgetly:comfort', JSON.stringify({ motion: 'reduced' }))
  const { container } = render(<WelcomeScreen onGuest={vi.fn()} renderAuth={auth}/>)
  expect(container.querySelector('.welcome-greeting').style.getPropertyValue('--welcome-duration')).toBe('6s')
  expect(container.querySelector('.welcome-greeting')).toHaveAttribute('data-motion', 'reduced')
  expect(() => saveWelcomeSpeed(999)).toThrow()
  expect(readWelcomeSpeed()).toBe(6)
})

test('returning guests can authenticate immediately without losing access to the guest workspace', async () => {
  const enter = vi.fn()
  render(<WelcomeScreen returningGuest onGuest={enter} renderAuth={auth}/>)
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: 'Return to guest workspace' }))
  await waitFor(() => expect(enter).toHaveBeenCalledTimes(1))
})
