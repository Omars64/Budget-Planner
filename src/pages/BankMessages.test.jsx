import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import BankMessages from './BankMessages'
import { api } from '../lib/api'
vi.mock('../App', () => ({ useApp: () => ({ user: { id: 1 }, settings: { currency: 'KWD' }, activeSpace: { id: 17, name: 'Home Expense' }, spaces: [{ id: 17, name: 'Home Expense', role: 'owner' }], canAdd: true, refresh: vi.fn(), notify: vi.fn() }) }))
vi.mock('../lib/api', () => ({ api: vi.fn(), jsonBody: data => ({ body: JSON.stringify(data) }) }))
vi.mock('../components/BankNotificationSetup', () => ({ default: () => <p>Native setup</p> }))
vi.mock('../lib/bankNotifications/native', () => ({ bankInboxChanged: 'bank-changed', syncBankNotifications: vi.fn() }))
const item = { id: 3, merchant: 'Talabat', source_app: 'Bank', amount: '6.750', currency: 'KWD', transaction_type: 'expense', wallet_id: 5, category_id: null, occurred_at: '2026-10-08T12:00:00', confidence: 0.95, reasons: ['Amount detected'], duplicates: [], refund_matches: [] }
afterEach(() => { cleanup(); vi.clearAllMocks() })
it('reviews a Space alert and sends an ordinary editable transaction only after approval', async () => {
  api.mockImplementation(path => Promise.resolve(path.startsWith('/api/bank-inbox?') ? { items: [item], total: 1 } : path === '/api/wallets' ? [{ id: 5, name: 'Home Card' }] : path === '/api/categories' ? [] : { status: 'approved', transaction_id: 7 }))
  render(<BankMessages/> )
  await screen.findByText('Talabat')
  expect(screen.getByText('Bank notification setup').closest('details')).not.toHaveAttribute('open')
  fireEvent.click(screen.getByRole('button', { name: 'Review & add' }))
  fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Lunch' } })
  fireEvent.click(screen.getByRole('button', { name: 'Approve transaction' }))
  await waitFor(() => expect(api).toHaveBeenCalledWith('/api/bank-inbox/3/approve', expect.objectContaining({ method: 'POST' })))
  const payload = JSON.parse(api.mock.calls.find(([path]) => path.endsWith('/approve'))[1].body)
  expect(payload).toMatchObject({ type: 'expense', amount: '6.750', description: 'Lunch', wallet_id: 5, transfer_wallet_id: null })
})
it('requires explicit duplicate confirmation and shows a refund as credit', async () => {
  api.mockImplementation(path => Promise.resolve(path.startsWith('/api/bank-inbox?') ? { items: [{ ...item, transaction_type: 'refund', duplicates: [{ id: 8, description: 'Earlier credit', date: item.occurred_at }] }], total: 1 } : path === '/api/wallets' ? [{ id: 5, name: 'Home Card' }] : []))
  render(<BankMessages/> )
  fireEvent.click(await screen.findByRole('button', { name: 'Review & add' }))
  expect(screen.getByLabelText('Record as')).toHaveValue('income')
  expect(screen.getByRole('button', { name: 'Approve transaction' })).toBeDisabled()
  expect(screen.getByLabelText('For month')).toBeRequired()
  fireEvent.click(screen.getByLabelText('I checked; add anyway'))
  expect(screen.getByRole('button', { name: 'Approve transaction' })).toBeEnabled()
})
