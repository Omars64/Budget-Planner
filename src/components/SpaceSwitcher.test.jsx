import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import SpaceSwitcher from './SpaceSwitcher'

const mocks = vi.hoisted(() => ({ app: {}, api: vi.fn() }))
vi.mock('../App', () => ({ useApp: () => mocks.app }))
vi.mock('../lib/api', () => ({ api: (...args) => mocks.api(...args), jsonBody: value => ({ body: JSON.stringify(value) }) }))
vi.mock('./CurrencyField', () => ({ default: () => null }))
vi.mock('./Modal', () => ({ default: ({ open, children, title }) => open ? <section aria-label={title}>{children}</section> : null }))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.app = {
    activeSpace: { id: 7, name: 'Home', role: 'owner', color: 'green', currency: 'KWD',
      members: [{ email: 'owner@test.example', role: 'owner' }, { email: 'manager@test.example', role: 'edit' }] },
    spaces: [], settings: { currency: 'KWD' }, switchSpace: vi.fn(), reloadSpaces: vi.fn(),
    notify: vi.fn(), confirm: vi.fn().mockResolvedValue(true),
  }
})
afterEach(cleanup)

function openMembers() {
  fireEvent.click(screen.getByRole('button', { name: /Switch space/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Space settings & members' }))
}

it('offers only Viewer and Manager, defaults to Viewer and preserves an existing Manager', () => {
  render(<SpaceSwitcher/> )
  openMembers()
  const role = screen.getByRole('combobox', { name: 'Role' })
  expect(within(role).getAllByRole('option').map(option => option.value)).toEqual(['view', 'edit'])
  expect(role).toHaveValue('view')
  fireEvent.click(screen.getByRole('button', { name: 'Change role for manager@test.example' }))
  expect(role).toHaveValue('edit')
  expect(screen.getByRole('textbox', { name: 'Email' })).toHaveValue('manager@test.example')
})

it('keeps membership controls owner-only while showing the Manager role clearly', () => {
  mocks.app.activeSpace.role = 'edit'
  render(<SpaceSwitcher/> )
  openMembers()
  expect(screen.getByText(/Your role: Manager/)).toBeInTheDocument()
  expect(screen.queryByRole('combobox', { name: 'Role' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Change role/ })).not.toBeInTheDocument()
})
