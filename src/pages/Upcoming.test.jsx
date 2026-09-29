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

it('shows every record detail without a sideways table and filters with the in-app menu', async () => {
  render(<Upcoming/>)
  expect(await screen.findByText('October rent')).toBeInTheDocument()
  expect(screen.getByText('Main')).toBeInTheDocument()
  expect(screen.getByText('Housing')).toBeInTheDocument()
  expect(screen.getByText('Reminder on')).toBeInTheDocument()
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Plan status: Upcoming' }))
  expect(screen.getByRole('menu', { name: 'Plan status' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Recorded' }))
  expect(screen.getByText('No entries in this view.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Plan status: Recorded' })).toBeInTheDocument()
})

it('uses the shared calendar and clock and keeps the reminder label visible when creating', async () => {
  render(<Upcoming/>)
  await screen.findByText('October rent')
  fireEvent.click(screen.getByRole('button', { name: 'Add plan' }))
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
