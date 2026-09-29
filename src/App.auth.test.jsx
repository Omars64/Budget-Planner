import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { LoginScreen } from './App'

test('expanded auth keeps login, signup, and password recovery reachable', async () => {
  const user = userEvent.setup()
  render(<LoginScreen onLogin={vi.fn()} />)

  expect(screen.getByRole('main')).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Sign in to Budgetly' })).toBeInTheDocument()
  expect(screen.getByLabelText('Email')).toBeInTheDocument()
  expect(screen.getByLabelText('Password')).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Create an account' }))
  expect(screen.getByRole('heading', { name: 'Create your Budgetly account' })).toBeInTheDocument()
  expect(screen.getByLabelText('Username')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Continue to email verification' })).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Sign in', exact: true }))
  await user.click(screen.getByRole('button', { name: 'Forgot password?' }))
  expect(screen.getByRole('heading', { name: 'Reset password' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Send reset link' })).toBeInTheDocument()
})
