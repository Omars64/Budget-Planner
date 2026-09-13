import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import AskAI from './AskAI'
import { api } from '../lib/api'

vi.mock('../App', () => ({ useApp: () => ({ notify: vi.fn(), confirm: vi.fn(), refresh: vi.fn() }) }))
vi.mock('../lib/api', () => ({ api: vi.fn(), jsonBody: data => ({ body: JSON.stringify(data) }) }))
afterEach(cleanup)
beforeEach(() => {
  window.localStorage.clear(); vi.clearAllMocks()
  window.matchMedia = vi.fn(() => ({ matches: false }))
  window.Element.prototype.scrollTo = vi.fn()
  api.mockImplementation(path => Promise.resolve(path === '/api/ai/config' ? { wallets: [], shared_wallets: [], ai_available: false } : { items: [], has_more: false }))
})
it('has one new-chat button, expandable history and a compact composer', async () => {
  const { container } = render(<MemoryRouter><AskAI/></MemoryRouter>)
  await waitFor(() => expect(screen.getByText('Built-in guide')).toBeInTheDocument())
  expect(screen.getAllByRole('button', { name: 'New conversation' })).toHaveLength(1)
  expect(screen.queryByText('Budgetly Help')).not.toBeInTheDocument()
  expect(screen.queryByText(/food and dining/i)).not.toBeInTheDocument()
  expect(screen.getByLabelText('Message Ask Budgetly')).toHaveAttribute('rows', '1')
  fireEvent.click(screen.getByRole('button', { name: 'Toggle conversations' }))
  expect(container.querySelector('.ai-workspace')).toHaveClass('history-collapsed')
  fireEvent.click(screen.getByRole('button', { name: 'Toggle conversations' }))
  expect(container.querySelector('.ai-workspace')).not.toHaveClass('history-collapsed')
  expect(screen.queryByRole('switch')).not.toBeInTheDocument()
})
