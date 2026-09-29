import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import Attention from './Attention'
import { api } from '../lib/api'

vi.mock('../lib/api', () => ({ api: vi.fn() }))
afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  api.mockResolvedValue({ items: [{ id: 'budget:1', kind: 'budget', severity: 'warning', title: 'Food limit needs attention', detail: 'KWD 90.000 of KWD 100.000 used this month.', path: '/budgets', action_label: 'Open budget' }], count: 1, has_more: false })
})

it('renders actionable items and links to the existing workflow', async () => {
  render(<MemoryRouter><Attention /></MemoryRouter>)
  expect(await screen.findByText('Food limit needs attention')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /Open budget/i })).toHaveAttribute('href', '/budgets')
  expect(screen.getByRole('button', { name: 'Refresh attention list' })).toBeInTheDocument()
})
