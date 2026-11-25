import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import BankMessages from './BankMessages'
import { api } from '../lib/api'
vi.mock('../App', () => ({ useApp: () => ({ user: { id: 1 }, settings: { currency: 'KWD' }, activeSpace: { id: 17, name: 'Home Expense' }, spaces: [{ id: 17, name: 'Home Expense', role: 'owner' }], canAdd: true, refresh: vi.fn(), notify: vi.fn() }) }))
vi.mock('../lib/api', () => ({ api: vi.fn(), jsonBody: data => ({ body: JSON.stringify(data) }) }))
vi.mock('../components/BankNotificationSetup', () => ({ default: () => <p>Native setup</p> }))
vi.mock('../lib/bankNotifications/native', () => ({ bankInboxChanged: 'bank-changed', syncBankNotifications: vi.fn() }))
const item = { id: 3, merchant: 'Talabat', source_app: 'Bank', amount: '6.750', currency: 'KWD', transaction_type: 'expense', wallet_id: 5, category_id: null, occurred_at: '2026-10-08T12:00:00', confidence: 0.95, reasons: ['Amount detected'], duplicates: [], refund_matches: [] }
const mockInbox = (detail = item) => {
  api.mockImplementation(path => Promise.resolve(path.startsWith('/api/bank-inbox?') ? { items:[{
    id:detail.id, merchant:detail.merchant, amount:detail.amount, currency:detail.currency,
    transaction_type:detail.transaction_type, wallet_id:detail.wallet_id, possible_duplicate:!!detail.duplicates.length,
  }], total:1 } : path === '/api/bank-inbox/3' ? detail : path === '/api/wallets' ? [{id:5,name:'Home Card'}]
    : path === '/api/categories' ? [] : {status:'approved',transaction_id:7}))
}
afterEach(() => { cleanup(); vi.clearAllMocks() })
it('reviews a Space alert and sends an ordinary editable transaction only after approval', async () => {
  mockInbox()
  render(<BankMessages/> )
  await screen.findByText('Talabat')
  expect(screen.queryByText('Bank notification setup')).not.toBeInTheDocument()
  expect(api.mock.calls.some(([path]) => path === '/api/bank-inbox/3')).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Review', exact:true }))
  fireEvent.change(await screen.findByLabelText('Description'), { target: { value: 'Lunch' } })
  fireEvent.click(screen.getByRole('button', { name: 'Approve transaction' }))
  await waitFor(() => expect(api).toHaveBeenCalledWith('/api/bank-inbox/3/approve', expect.objectContaining({ method: 'POST' })))
  const payload = JSON.parse(api.mock.calls.find(([path]) => path.endsWith('/approve'))[1].body)
  expect(payload).toMatchObject({ type: 'expense', amount: '6.750', description: 'Lunch', wallet_id: 5, transfer_wallet_id: null })
})
it('requires explicit duplicate confirmation and shows a refund as credit', async () => {
  mockInbox({ ...item, transaction_type:'refund', duplicates:[{ id:8, description:'Earlier credit', date:item.occurred_at }] })
  render(<BankMessages/> )
  expect(await screen.findByText('Possible duplicate')).toBeInTheDocument()
  fireEvent.click(await screen.findByRole('button', { name: 'Review', exact:true }))
  expect(await screen.findByLabelText('Record as')).toHaveValue('income')
  fireEvent.change(screen.getByLabelText('For month'), { target: { value: '2026-10' } })
  fireEvent.click(screen.getByRole('button', { name: 'Approve transaction' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Check the similar transaction')
  expect(api.mock.calls.some(([path]) => path.endsWith('/approve'))).toBe(false)
  expect(screen.getByLabelText('For month')).toBeRequired()
  fireEvent.click(screen.getByLabelText('I checked; add anyway'))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})
it('explains which required review field needs attention', async () => {
  mockInbox()
  render(<BankMessages/>)
  fireEvent.click(await screen.findByRole('button', { name: 'Review', exact:true }))
  fireEvent.invalid(await screen.findByLabelText('Wallet'))
  expect(screen.getByRole('alert')).toHaveTextContent('Check Wallet before approving')
})

it('ignores from the list without loading review details', async () => {
  mockInbox()
  render(<BankMessages/>)
  fireEvent.click(await screen.findByRole('button', { name: 'Ignore', exact: true }))
  await waitFor(() => expect(api).toHaveBeenCalledWith('/api/bank-inbox/3/ignore', { method: 'POST' }))
  expect(api.mock.calls.some(([path]) => path === '/api/bank-inbox/3')).toBe(false)
})

it('opens destination selection directly from review without approving', async () => {
  mockInbox()
  render(<BankMessages/>)
  fireEvent.click(await screen.findByRole('button', { name: 'Review', exact: true }))
  const approve = await screen.findByRole('button', { name: 'Approve transaction' })
  const move = screen.getByRole('button', { name: 'Change destination' })
  expect(move.parentElement).toBe(approve.parentElement)
  fireEvent.click(move)
  expect(await screen.findByRole('heading', { name: 'Change alert destination' })).toBeInTheDocument()
  expect(api.mock.calls.some(([path]) => path.endsWith('/approve'))).toBe(false)
})
