import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import GuestImport from './GuestImport'
import { api } from '../lib/api'
import { GUEST_KEY, GUEST_IMPORT_KEY, guestApi, readGuest } from '../lib/guest'

vi.mock('../lib/api', async original => ({ ...await original(), api: vi.fn() }))
const user = { id: 42, username: 'Alex', email: 'alex@example.test' }
beforeEach(async () => {
  vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear()
  await guestApi('/api/transactions', { method: 'POST', body: JSON.stringify({ type: 'expense', amount: 2, description: 'Lunch', date: '2026-10-05T09:00:00Z', wallet_id: 1, category_id: 2 }) })
  api.mockResolvedValue({ transactions: 1, wallets: 1, budgets: 0, wallet_map: { 1: 80 }, category_map: { 2: 90 } })
})
afterEach(cleanup)
const mount = (onDone, account = user) => render(<MemoryRouter><GuestImport user={account} onDone={onDone}/></MemoryRouter>)

test('damaged pending marker shows recovery error without clearing local records', () => {
  localStorage.setItem(GUEST_IMPORT_KEY, 'broken')
  const before = localStorage.getItem(GUEST_KEY)
  mount(vi.fn())
  expect(screen.getByRole('alert')).toHaveTextContent('have not been deleted')
  expect(screen.getByRole('button', {name:'Keep my records'})).toBeDisabled()
  expect(localStorage.getItem(GUEST_KEY)).toBe(before)
  expect(api).not.toHaveBeenCalled()
})

test('no automatic import; declining keeps every local record', () => {
  const done = vi.fn(), before = localStorage.getItem(GUEST_KEY)
  mount(done)
  expect(screen.getByText(/alex@example.test/)).toBeInTheDocument()
  expect(api).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Keep on device for now' }))
  expect(done).toHaveBeenCalled()
  expect(localStorage.getItem(GUEST_KEY)).toBe(before)
})
test('server failure retains frozen data; a retry uses exactly the same payload', async () => {
  const done = vi.fn()
  api.mockRejectedValueOnce(new Error('Connection lost'))
  mount(done)
  fireEvent.click(screen.getByRole('button', { name: 'Keep my records' }))
  await screen.findByRole('alert')
  expect(readGuest().transactions).toHaveLength(1)
  const first = api.mock.calls[0][1].body
  expect(localStorage.getItem(GUEST_IMPORT_KEY)).not.toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Keep my records' }))
  await waitFor(() => expect(done).toHaveBeenCalled())
  expect(api.mock.calls[1][1].body).toBe(first)
  expect(localStorage.getItem(GUEST_KEY)).toBeNull()
  expect(localStorage.getItem(GUEST_IMPORT_KEY)).toBeNull()
})
test('a pending import cannot silently be moved into another account', async () => {
  const done = vi.fn()
  api.mockRejectedValueOnce(new Error('Connection lost'))
  mount(done)
  fireEvent.click(screen.getByRole('button', { name: 'Keep my records' }))
  await screen.findByRole('alert')
  cleanup(); vi.clearAllMocks()
  mount(done, { ...user, id: 99 })
  fireEvent.click(screen.getByRole('button', { name: 'Keep my records' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('account where this import was started')
  expect(api).not.toHaveBeenCalled()
  expect(readGuest().transactions).toHaveLength(1)
})
test('scheduled draft maps to imported account wallets and categories', async () => {
  sessionStorage.setItem('budgetly_guest_schedule', 'true')
  sessionStorage.setItem('flowbudget_tx_draft_guest', JSON.stringify({ wallet_id: 1, category_id: 2, description: 'Future rent', type: 'expense' }))
  const done = vi.fn(); mount(done)
  fireEvent.click(screen.getByRole('button', { name: 'Keep my records' }))
  await waitFor(() => expect(done).toHaveBeenCalled())
  expect(JSON.parse(sessionStorage.getItem('flowbudget_tx_draft_42'))).toMatchObject({ wallet_id: 80, category_id: 90, description: 'Future rent' })
  expect(sessionStorage.getItem('budgetly_schedule_resume_42')).toBe('true')
})
