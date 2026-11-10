import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import Upcoming from './Upcoming'
import { api } from '../lib/api'

const rows = [{ id: 7, description: 'October rent', type: 'expense', amount: 13.677, date: '2026-10-01T09:00:00+03:00', wallet_id: 1, wallet_name: 'Main', category_name: 'Housing', status: 'planned', shared: false, reminder_enabled: true, can_edit: true }]
const notify = vi.hoisted(() => vi.fn())
vi.mock('../App', () => ({ useApp: () => ({ user: { id: 4 }, settings: { currency: 'KWD' }, notify, confirm: vi.fn(async () => true) }) }))
vi.mock('../lib/api', () => ({ api: vi.fn(), jsonBody: data => ({ body: JSON.stringify(data) }), money: (value, currency) => `${currency} ${Number(value).toFixed(3)}` }))
beforeAll(() => {
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
  window.HTMLDialogElement.prototype.close = function () { this.open = false }
})
beforeEach(() => {
  vi.clearAllMocks()
  api.mockImplementation(path => Promise.resolve(path === '/api/planned-transactions' ? rows : path === '/api/wallets' ? [{ id: 1, name: 'Main', archived: false, is_shared: false }] : []))
})
afterEach(cleanup)

it('shows compact rows, keeps record details accessible and switches to recorded entries', async () => {
  render(<Upcoming/>)
  expect(await screen.findByText('October rent')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /October rent/ }))
  expect(screen.getByText('Main')).toBeInTheDocument()
  expect(screen.getByText('Housing')).toBeInTheDocument()
  expect(screen.getByText('Reminder on')).toBeInTheDocument()
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }))
  fireEvent.click(screen.getByRole('button', { name: 'Recorded' }))
  expect(screen.getByText('No entries in this view.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Recorded' })).toHaveAttribute('aria-pressed', 'true')
})

it('uses the shared calendar and clock and keeps the reminder label visible when creating', async () => {
  render(<Upcoming/>)
  await screen.findByText('October rent')
  fireEvent.click(screen.getByRole('button', { name: 'Schedule an entry' }))
  const editor = screen.getByRole('dialog', { name: 'Add upcoming entry' })
  expect(editor).toHaveAttribute('aria-modal', 'true')
  const form = within(editor).getByLabelText('Description').closest('form')
  expect(within(editor).getByRole('button', { name: 'Save entry' })).toHaveAttribute('form', form.id)
  expect(screen.getByRole('checkbox', { name: 'Remind me' })).toBeChecked()
  expect(document.querySelector('input[type="datetime-local"]')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Date', exact: true }))
  expect(screen.getByRole('dialog', { name: 'Choose date' })).toBeInTheDocument()
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Choose date' })).getByRole('button', { name: 'Cancel' }))
  fireEvent.click(screen.getByRole('button', { name: 'Time', exact: true }))
  expect(screen.getByRole('dialog', { name: 'Choose time' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Set time' }))
  fireEvent.change(screen.getByLabelText('Amount (KWD)'), { target: { value: '2.250' } })
  fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Lunch' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save entry' }))
  await waitFor(() => expect(api).toHaveBeenCalledWith('/api/planned-transactions', expect.objectContaining({ method: 'POST' })))
  const body = JSON.parse(api.mock.calls.find(([path, options]) => path === '/api/planned-transactions' && options?.method === 'POST')[1].body)
  expect(body).toMatchObject({ reminder_enabled: true, transaction: { type: 'expense', description: 'Lunch', amount: 2.25, wallet_id: 1 } })
})

it('retains transfer destination, recording mode, and reminder controls in the popup', async () => {
  api.mockImplementation(path => Promise.resolve(path === '/api/planned-transactions' ? rows : path === '/api/wallets' ? [
    { id: 1, name: 'Main', archived: false, is_shared: false },
    { id: 2, name: 'Savings', archived: false, is_shared: false },
  ] : []))
  render(<Upcoming/>)
  await screen.findByText('October rent')
  fireEvent.click(screen.getByRole('button', { name: 'Schedule an entry' }))
  const editor = within(screen.getByRole('dialog', { name: 'Add upcoming entry' }))
  fireEvent.change(editor.getByLabelText('Type'), { target: { value: 'transfer' } })
  fireEvent.change(editor.getByLabelText('Destination'), { target: { value: '2' } })
  fireEvent.change(editor.getByLabelText('Amount (KWD)'), { target: { value: '3.5' } })
  fireEvent.change(editor.getByLabelText('Description'), { target: { value: 'Planned transfer' } })
  expect(editor.getByLabelText('Recording')).toHaveValue('planned')
  fireEvent.click(editor.getByRole('checkbox', { name: 'Remind me' }))
  fireEvent.click(editor.getByRole('button', { name: 'Save entry' }))
  await waitFor(() => expect(api).toHaveBeenCalledWith('/api/planned-transactions', expect.objectContaining({ method: 'POST' })))
  const payload = JSON.parse(api.mock.calls.find(([, options]) => options?.method === 'POST')[1].body)
  expect(payload).toMatchObject({ status: 'planned', reminder_enabled: false, transaction: { type: 'transfer', amount: 3.5, wallet_id: 1, transfer_wallet_id: 2, category_id: null, reporting_month: null } })
})

it('protects edited upcoming drafts when closing the popup', async () => {
  render(<Upcoming/>)
  fireEvent.click(await screen.findByRole('button', { name: /October rent/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Edit October rent' }))
  const editor = within(screen.getByRole('dialog', { name: 'Edit upcoming entry' }))
  fireEvent.change(editor.getByLabelText('Description'), { target: { value: 'Keep my draft' } })
  fireEvent.click(editor.getByRole('button', { name: 'Cancel' }))
  expect(editor.getByRole('alert')).toHaveTextContent('Discard your unsaved changes?')
  fireEvent.click(editor.getByRole('button', { name: 'Keep editing' }))
  expect(editor.getByLabelText('Description')).toHaveValue('Keep my draft')
  expect(api.mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(false)
})

it('keeps a conflicting draft visible and reloads the current revision only after confirmation', async () => {
  const original = { ...rows[0], revision: 'plan-original' }
  let plans = [original]
  api.mockImplementation((path, options) => {
    if (options?.method === 'PUT') {
      plans = [{ ...original, amount: 25, revision: 'plan-newer' }]
      return Promise.reject(Object.assign(new Error('This entry changed. Reload before saving.'), { status: 409 }))
    }
    return Promise.resolve(path === '/api/planned-transactions' ? plans : path === '/api/wallets' ? [{ id: 1, name: 'Main', archived: false, is_shared: false }] : [])
  })
  render(<Upcoming/>)
  fireEvent.click(await screen.findByRole('button', { name: /October rent/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Edit October rent' }))
  fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'My unsaved correction' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save entry' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('This entry changed')
  const update = api.mock.calls.find(([, options]) => options?.method === 'PUT')
  expect(JSON.parse(update[1].body)).toMatchObject({ revision: 'plan-original' })
  expect(screen.getByLabelText('Description')).toHaveValue('My unsaved correction')
  expect(screen.getByRole('button', { name: 'Save entry' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Reload latest entry' }))
  await waitFor(() => expect(screen.getByLabelText('Amount (KWD)')).toHaveValue(25))
  expect(screen.getByLabelText('Description')).toHaveValue('October rent')
  expect(screen.getByRole('button', { name: 'Save entry' })).toBeEnabled()
})
