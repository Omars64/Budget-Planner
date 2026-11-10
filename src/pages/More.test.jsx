import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import More from './More'

const mocks = vi.hoisted(() => ({ app: {}, requestSignIn: vi.fn() }))
vi.mock('../App', () => ({ useApp: () => mocks.app }))
vi.mock('../lib/workspacePreferences', () => ({ useWorkspacePreferences: () => [{ navOrder: [] }] }))
beforeEach(() => { mocks.requestSignIn.mockReset(); mocks.app = {user:{id:1,role:'user'}, settings:{}, requestSignIn:mocks.requestSignIn} })
afterEach(cleanup)

it('keeps all existing tools available with their real routes', () => {
  render(<MemoryRouter><More/></MemoryRouter>)
  expect(screen.getByRole('link', {name:/Calendar/})).toHaveAttribute('href','/calendar')
  expect(screen.getByRole('link', {name:/Notes/})).toHaveAttribute('href','/notes')
  expect(screen.getByRole('link', {name:/Settings/})).toHaveAttribute('href','/settings')
  expect(screen.getByRole('link', {name:/Spaces/})).toHaveAttribute('href','/spaces')
})

it('keeps sign out as the final More action', () => {
  mocks.app.lock = vi.fn()
  render(<MemoryRouter><More/></MemoryRouter>)
  const signout = screen.getByRole('button', {name:/Sign out/})
  expect(document.querySelector('.more-page').lastElementChild).toContainElement(signout)
  fireEvent.click(signout)
  expect(mocks.app.lock).toHaveBeenCalledOnce()
})
it('preserves guest restrictions while leaving the directory accessible', () => {
  mocks.app.isGuest = true
  render(<MemoryRouter><More/></MemoryRouter>)
  fireEvent.click(screen.getByRole('link', {name:/Calendar/}))
  expect(mocks.requestSignIn).toHaveBeenCalledWith('Calendar')
  fireEvent.click(screen.getByRole('link', {name:/Budgets/}))
  expect(mocks.requestSignIn).toHaveBeenCalledTimes(1)
})
it('hides Personal-only AI in Spaces and exposes admin controls only to admins', () => {
  mocks.app.activeSpace = {id:9}; mocks.app.user.role = 'admin'
  render(<MemoryRouter><More/></MemoryRouter>)
  expect(screen.queryByRole('link', {name:/Ask Budgetly/})).not.toBeInTheDocument()
  expect(screen.getByRole('link', {name:/Admin controls/})).toHaveAttribute('href','/admin')
})
