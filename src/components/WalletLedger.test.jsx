import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import WalletLedger from './WalletLedger'

const request = vi.hoisted(() => vi.fn())
vi.mock('../App', () => ({ useApp: () => ({ refreshKey: 0 }) }))
vi.mock('../lib/api', () => ({
  api: request,
  jsonBody: value => ({ body: JSON.stringify(value) }),
  money: (value, currency) => `${currency} ${Number(value).toFixed(3)}`,
}))
vi.mock('./Modal', () => ({ default: ({ open, title, children }) => open ? <section role="dialog" aria-label={title}>{children}</section> : null }))

afterEach(() => { cleanup(); request.mockReset() })

const ledger = can_check => ({
  wallet_id: 1, wallet_name: 'Cash', currency: 'KWD', balance: 100, can_check,
  entries: [{ id: 2, date: '2026-09-02T09:00:00+03:00', description: 'Salary', type: 'income', change: 100, balance_after: 100 }],
  next_cursor: null,
})

it('keeps balance checks behind a tab and does not post a transaction', async () => {
  request.mockImplementation((path, options) => {
    if (options?.method === 'POST') return Promise.resolve({
      id: 1, expected_balance: 100, observed_balance: 95, difference: -5,
      matches: false, currency: 'KWD', note: '', checked_at: '2026-09-02T10:00:00Z', checked_by: 'Owner',
    })
    return Promise.resolve(path.endsWith('/checks') ? { checks: [], next_cursor: null } : ledger(true))
  })
  render(<MemoryRouter><WalletLedger wallet={{ id: 1, name: 'Cash' }} onClose={() => {}}/></MemoryRouter>)
  expect(await screen.findByText('Salary')).toBeInTheDocument()
  expect(screen.queryByLabelText(/Actual bank or cash balance/)).toBeNull()
  fireEvent.click(screen.getByRole('tab', { name: 'Balance checks' }))
  fireEvent.change(screen.getByLabelText(/Actual bank or cash balance/), { target: { value: '95' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save balance check' }))
  expect(await screen.findByText('Difference: -KWD 5.000')).toBeInTheDocument()
  await waitFor(() => expect(request).toHaveBeenCalledWith('/api/ledger/wallets/1/checks', expect.objectContaining({ method: 'POST' })))
  expect(request.mock.calls.filter(([path]) => path === '/api/transactions')).toHaveLength(0)
})

it('shows shared viewers the ledger without a balance-check form', async () => {
  request.mockImplementation(path => Promise.resolve(path.endsWith('/checks') ? { checks: [], next_cursor: null } : ledger(false)))
  render(<MemoryRouter><WalletLedger wallet={{ wallet_id: 1, name: 'Household' }} shared onClose={() => {}}/></MemoryRouter>)
  expect(await screen.findByText('Salary')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('tab', { name: 'Balance checks' }))
  expect(screen.queryByRole('button', { name: 'Save balance check' })).toBeNull()
})
