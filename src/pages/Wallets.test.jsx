import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import Wallets from './Wallets'
import { api } from '../lib/api'

vi.mock('../App', () => ({ useApp: () => ({ settings: { currency: 'KWD' }, refreshKey: 0, refresh: vi.fn(), notify: vi.fn(), confirm: vi.fn() }) }))
vi.mock('../lib/api', () => ({ api: vi.fn(), jsonBody: value => ({ body: JSON.stringify(value) }), money: value => `KWD ${Number(value).toFixed(3)}` }))
vi.mock('../components/WalletLedger', () => ({ default: () => null }))
afterEach(() => { cleanup(); vi.clearAllMocks() })

it('renders the saved card color independently of glass and saves preset or custom changes', async () => {
  api.mockResolvedValue([{ id: 1, name: 'Emerald', type: 'bank', color: '#183d36', card_network: 'mastercard', balance: 100, initial_balance: 100 }])
  render(<Wallets/> )
  await screen.findByText('Emerald')
  const card = document.querySelector('.wallet-card.payment-card')
  expect(card).not.toHaveClass('glass')
  expect(card.style.getPropertyValue('--wallet-card-color')).toBe('#183d36')
  fireEvent.click(screen.getByRole('button', { name: 'Edit Emerald' }))
  expect(screen.getAllByRole('button', { name: /^(Blue|Teal|Berry|Graphite|Emerald|Midnight|Burgundy|Amethyst|Titanium|Ocean|Rose|Onyx)$/ }).length).toBe(12)
  fireEvent.click(screen.getByRole('button', { name: 'Amethyst', exact: true }))
  fireEvent.change(screen.getByLabelText('Custom card color'), { target: { value: '#fafafa' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save wallet' }))
  await waitFor(() => expect(api).toHaveBeenCalledWith('/api/wallets/1', expect.objectContaining({ method: 'PUT' })))
  const call = api.mock.calls.find(([path, options]) => path === '/api/wallets/1' && options?.method === 'PUT')
  expect(JSON.parse(call[1].body)).toMatchObject({ color: '#fafafa', card_network: 'mastercard', initial_balance: 100 })
})
