import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import SpaceSwitcher from './SpaceSwitcher'

const mocks = vi.hoisted(() => ({ app: {}, api: vi.fn() }))
vi.mock('../App', () => ({ useApp: () => mocks.app }))
vi.mock('../lib/api', () => ({ api: (...args) => mocks.api(...args), jsonBody: value => ({ body: JSON.stringify(value) }) }))
vi.mock('./CurrencyField', () => ({ default: () => null }))
vi.mock('./Modal', () => ({ default: ({ open, children, title, isDirty, onClose }) => open ? <section aria-label={title} data-dirty={isDirty}><button onClick={onClose}>Close dialog</button>{children}</section> : null }))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.api.mockReset()
  mocks.app = {
    activeSpace: { id: 7, name: 'Home', role: 'owner', color: 'green', currency: 'KWD',
      members: [{ email: 'owner@test.example', role: 'owner' }, { email: 'manager@test.example', role: 'edit' }] },
    spaces: [], settings: { currency: 'KWD' }, switchSpace: vi.fn(), reloadSpaces: vi.fn(),
    notify: vi.fn(), confirm: vi.fn().mockResolvedValue(true),
  }
  mocks.app.spaces = [mocks.app.activeSpace, { ...mocks.app.activeSpace, id: 8, name: 'Trip' }]
})
afterEach(cleanup)

function openWorkspace(name = 'Home', readOnly = false) {
  fireEvent.click(screen.getByRole('button', { name: /Switch space/ }))
  fireEvent.click(screen.getByRole('button', { name: `${readOnly ? 'View settings & members' : 'Manage workspace'} ${name}` }))
}

function openMembers(name = 'Home', readOnly = false) {
  openWorkspace(name, readOnly)
  fireEvent.click(screen.getByRole('button', { name: 'Members', exact: true }))
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

it.each(['edit', 'add', 'view'])('keeps settings and membership read-only for %s', role => {
  mocks.app.activeSpace.role = role
  render(<SpaceSwitcher/> )
  openWorkspace('Home', true)
  expect(screen.getByText(new RegExp(`Your role: ${role === 'view' ? 'Viewer' : 'Manager'}`))).toBeInTheDocument()
  expect(screen.getByText('KWD')).toBeInTheDocument()
  expect(screen.queryByRole('textbox', { name: 'Space name' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Save Space details' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Members', exact: true }))
  expect(screen.getByText('manager@test.example')).toBeInTheDocument()
  expect(screen.queryByRole('combobox', { name: 'Role' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Change role/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Save membership' })).not.toBeInTheDocument()
  expect(mocks.api).not.toHaveBeenCalled()
})

it('manages and saves a listed non-active Space without entering it', async () => {
  const trip = mocks.app.spaces[1]
  mocks.api.mockResolvedValue({ ...trip, name: 'Summer trip' })
  const { rerender } = render(<SpaceSwitcher/>)
  openWorkspace('Trip')
  fireEvent.change(screen.getByRole('textbox', { name: 'Space name' }), { target: { value: 'Summer trip' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save Space details' }))
  expect(await screen.findByText('Space details saved.')).toBeInTheDocument()
  expect(mocks.api).toHaveBeenCalledWith('/api/spaces/8', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ name: 'Summer trip', color: 'green', currency: 'KWD' }) }))
  mocks.app.activeSpace = null
  rerender(<SpaceSwitcher/>)
  expect(screen.getByRole('textbox', { name: 'Space name' })).toHaveValue('Summer trip')
  expect(mocks.app.switchSpace).not.toHaveBeenCalled()
  expect(mocks.app.reloadSpaces).toHaveBeenCalledOnce()
})

it('saves membership independently and preserves dirty Space details through refresh', async () => {
  const trip = mocks.app.spaces[1]
  let finish
  mocks.api.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const { rerender } = render(<SpaceSwitcher/>)
  openWorkspace('Trip')
  fireEvent.change(screen.getByRole('textbox', { name: 'Space name' }), { target: { value: 'Unsaved trip name' } })
  fireEvent.click(screen.getByRole('button', { name: 'Members', exact: true }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), { target: { value: 'NEW@test.example' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save membership' }))
  await waitFor(() => expect(mocks.api).toHaveBeenCalledOnce())
  expect(screen.getByRole('status')).toHaveTextContent('Saving membership...')
  expect(screen.getByRole('button', { name: 'Saving membership...' })).toBeDisabled()
  fireEvent.submit(screen.getByRole('form', { name: 'Add or update member' }))
  expect(mocks.api).toHaveBeenCalledOnce()
  await act(async () => finish({ ...trip, members: [...trip.members, { email: 'new@test.example', role: 'view' }] }))
  expect(await screen.findByText('Membership saved.')).toBeInTheDocument()
  expect(screen.getByText('new@test.example')).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Email' })).toHaveValue('')
  expect(mocks.api).toHaveBeenCalledWith('/api/spaces/8/members', { method: 'PUT', body: JSON.stringify({ email: 'new@test.example', role: 'view' }) })
  mocks.app.activeSpace = { ...mocks.app.activeSpace }
  rerender(<SpaceSwitcher/>)
  fireEvent.click(screen.getByRole('button', { name: 'Space details', exact: true }))
  expect(screen.getByRole('textbox', { name: 'Space name' })).toHaveValue('Unsaved trip name')
  expect(screen.getByRole('region', { name: 'Trip' })).toHaveAttribute('data-dirty', 'true')
  expect(mocks.app.switchSpace).not.toHaveBeenCalled()
})

it('keeps failed membership drafts, reports the error inline, and allows retry', async () => {
  mocks.api.mockRejectedValueOnce(new Error('Membership could not be saved.'))
  mocks.api.mockResolvedValueOnce(mocks.app.spaces[1])
  render(<SpaceSwitcher/>)
  openMembers('Trip')
  fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), { target: { value: 'new@test.example' } })
  fireEvent.change(screen.getByRole('combobox', { name: 'Role' }), { target: { value: 'edit' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save membership' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Membership could not be saved.')
  expect(screen.getByRole('textbox', { name: 'Email' })).toHaveValue('new@test.example')
  expect(screen.getByRole('combobox', { name: 'Role' })).toHaveValue('edit')
  expect(screen.getByRole('button', { name: 'Save membership' })).toBeEnabled()
  expect(mocks.app.reloadSpaces).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Save membership' }))
  expect(await screen.findByText('Membership saved.')).toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(mocks.api).toHaveBeenCalledTimes(2)
})

it('blocks duplicate submissions while confirmation is pending and handles cancellation', async () => {
  let finish
  mocks.app.confirm.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  render(<SpaceSwitcher/>)
  openMembers()
  fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), { target: { value: 'new@test.example' } })
  const form = screen.getByRole('form', { name: 'Add or update member' })
  fireEvent.submit(form)
  fireEvent.submit(form)
  fireEvent.click(screen.getByRole('button', { name: 'Remove manager@test.example' }))
  expect(mocks.app.confirm).toHaveBeenCalledOnce()
  await act(async () => finish(false))
  expect(mocks.api).not.toHaveBeenCalled()
  expect(screen.getByRole('textbox', { name: 'Email' })).toHaveValue('new@test.example')
  expect(screen.getByRole('button', { name: 'Save membership' })).toBeEnabled()
})

it('validates blank names and owner membership without issuing requests', () => {
  render(<SpaceSwitcher/>)
  openWorkspace()
  fireEvent.change(screen.getByRole('textbox', { name: 'Space name' }), { target: { value: '   ' } })
  fireEvent.submit(screen.getByRole('form', { name: 'Space details' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Enter a Space name.')
  fireEvent.change(screen.getByRole('textbox', { name: 'Space name' }), { target: { value: 'Home' } })
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Members', exact: true }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), { target: { value: 'owner@test.example' } })
  fireEvent.submit(screen.getByRole('form', { name: 'Add or update member' }))
  expect(screen.getByRole('alert')).toHaveTextContent('The owner already has full access.')
  expect(mocks.api).not.toHaveBeenCalled()
  expect(mocks.app.confirm).not.toHaveBeenCalled()
})

it('removes members from a non-active Space without losing the details draft', async () => {
  const trip = mocks.app.spaces[1]
  mocks.api.mockResolvedValue({ ...trip, members: trip.members.filter(person => person.role === 'owner') })
  render(<SpaceSwitcher/>)
  openWorkspace('Trip')
  fireEvent.change(screen.getByRole('textbox', { name: 'Space name' }), { target: { value: 'Draft' } })
  fireEvent.click(screen.getByRole('button', { name: 'Members', exact: true }))
  fireEvent.click(screen.getByRole('button', { name: 'Remove manager@test.example' }))
  expect(await screen.findByText('Member removed.')).toBeInTheDocument()
  expect(mocks.api).toHaveBeenCalledWith('/api/spaces/8/members/manager%40test.example', { method: 'DELETE' })
  expect(screen.queryByText('manager@test.example')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Space details', exact: true }))
  expect(screen.getByRole('textbox', { name: 'Space name' })).toHaveValue('Draft')
  expect(mocks.app.switchSpace).not.toHaveBeenCalled()
})

it('opens management directly from Personal without switching into the Space', () => {
  mocks.app.activeSpace = null
  render(<SpaceSwitcher/>)
  openWorkspace('Trip')
  expect(screen.getByRole('textbox', { name: 'Space name' })).toHaveValue('Trip')
  expect(mocks.app.switchSpace).not.toHaveBeenCalled()
})

it('reports persisted membership as saved even when refreshing the list fails', async () => {
  mocks.api.mockResolvedValue(mocks.app.spaces[1])
  mocks.app.reloadSpaces.mockRejectedValueOnce(new Error('Offline'))
  render(<SpaceSwitcher/>)
  openMembers('Trip')
  fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), { target: { value: 'new@test.example' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save membership' }))
  expect(await screen.findByText('Membership saved.')).toBeInTheDocument()
  await waitFor(() => expect(mocks.app.notify).toHaveBeenCalledWith(expect.stringContaining('could not refresh')))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(mocks.api).toHaveBeenCalledOnce()
})
