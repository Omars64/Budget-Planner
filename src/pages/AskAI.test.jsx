import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import AskAI from './AskAI'
import { api } from '../lib/api'
import { updateResourcePolicy } from '../lib/resourcePolicy'

vi.mock('../App', () => ({ useApp: () => ({ notify: vi.fn(), confirm: vi.fn(), refresh: vi.fn() }) }))
vi.mock('../lib/api', () => ({ api: vi.fn(), jsonBody: data => ({ body: JSON.stringify(data) }) }))
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); updateResourcePolicy({client_poll_seconds:60}) })
beforeEach(() => {
  window.localStorage.clear(); vi.clearAllMocks()
  window.matchMedia = vi.fn(() => ({ matches: false }))
  window.Element.prototype.scrollTo = vi.fn()
  api.mockImplementation(path => Promise.resolve(path === '/api/ai/config' ? { wallets: [], shared_wallets: [], ai_available: false } : { items: [], has_more: false }))
})

it('uses fast reads only during generation and pauses them when hidden or offline', async () => {
  vi.useFakeTimers()
  let status = 'pending'
  const visibility = vi.spyOn(document,'visibilityState','get').mockReturnValue('visible')
  const connectivity = vi.spyOn(navigator,'onLine','get').mockReturnValue(true)
  api.mockImplementation(path => Promise.resolve(path === '/api/ai/config' ? {wallets:[],shared_wallets:[]}
    : path === '/api/ai/chats/chat-1' ? {id:'chat-1',scope:'personal',turns:[{id:'turn-1',question:'Question',status,answer:status==='completed'?'Done':'',sources:[]}]}
      : {items:[],has_more:false}))
  render(<MemoryRouter initialEntries={['/ask-ai?chat=chat-1']}><AskAI/></MemoryRouter>)
  const reads = () => api.mock.calls.filter(([path]) => path === '/api/ai/chats/chat-1').length
  await act(async () => vi.advanceTimersByTimeAsync(0))
  expect(reads()).toBe(1)
  act(() => updateResourcePolicy({client_poll_seconds:300}))
  await act(async () => vi.advanceTimersByTimeAsync(3000))
  expect(reads()).toBe(2)
  visibility.mockReturnValue('hidden'); document.dispatchEvent(new Event('visibilitychange'))
  await act(async () => vi.advanceTimersByTimeAsync(30000))
  expect(reads()).toBe(2)
  connectivity.mockReturnValue(false); visibility.mockReturnValue('visible'); document.dispatchEvent(new Event('visibilitychange'))
  await act(async () => vi.advanceTimersByTimeAsync(30000))
  expect(reads()).toBe(2)
  status='completed'; connectivity.mockReturnValue(true)
  window.dispatchEvent(new Event('online')); window.dispatchEvent(new Event('focus'))
  await act(async () => vi.advanceTimersByTimeAsync(0))
  expect(reads()).toBe(3)
  await act(async () => vi.advanceTimersByTimeAsync(3000))
  expect(reads()).toBe(3)
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

it('creates a group with a saved memory preference and offers it for new chats', async () => {
  let groups = []
  api.mockImplementation((path, options) => {
    if (path === '/api/ai/groups' && options?.method === 'POST') {
      groups = [{ id: 'group-1', ...JSON.parse(options.body) }]
      return Promise.resolve(groups[0])
    }
    if (path === '/api/ai/groups') return Promise.resolve({ items: groups })
    return Promise.resolve(path === '/api/ai/config' ? { wallets: [], shared_wallets: [] } : { items: [], has_more: false })
  })
  render(<MemoryRouter><AskAI/></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: 'New group' }))
  fireEvent.change(screen.getByLabelText('Group name'), { target: { value: 'Travel' } })
  fireEvent.change(screen.getByLabelText('Memory / context'), { target: { value: 'general' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save group' }))
  await waitFor(() => expect(screen.getByText('Travel')).toBeInTheDocument())
  expect(screen.getByText('General context')).toBeInTheDocument()
  fireEvent.click(screen.getByText('Travel'))
  fireEvent.click(screen.getByRole('button', { name: 'New conversation' }))
  expect(screen.getByLabelText('Group')).toHaveValue('group-1')
})

it('selects history, clears the composer, loads older chats and closes mobile history', async () => {
  window.matchMedia = vi.fn(() => ({ matches: true }))
  const item = { id: 'chat-1', title: 'Monthly spending', scope: 'personal', month: '2026-10', accessible: true }
  api.mockImplementation(path => Promise.resolve(
    path === '/api/ai/config' ? { wallets: [], shared_wallets: [] }
      : path === '/api/ai/groups' ? { items: [] }
        : path === '/api/ai/chats/chat-1' ? { ...item, turns: [{ id: 'turn-1', question: 'Where did it go?', answer: 'Saved answer', sources: [], created_at: '2026-10-01T10:00:00Z', status: 'completed' }] }
          : { items: [item], has_more: true }
  ))
  const { container } = render(<MemoryRouter><AskAI/></MemoryRouter>)
  await screen.findByText('Monthly spending')
  fireEvent.click(screen.getByText('Older conversations'))
  await waitFor(() => expect(api).toHaveBeenCalledWith('/api/ai/chats?offset=1'))
  fireEvent.change(screen.getByLabelText('Message Ask Budgetly'), { target: { value: 'Unsent text' } })
  fireEvent.click(screen.getByLabelText('Toggle conversations'))
  expect(container.querySelector('.ai-workspace')).toHaveClass('history-mobile-open')
  fireEvent.click(screen.getByText('Monthly spending'))
  await screen.findByText('Saved answer')
  expect(screen.getByLabelText('Message Ask Budgetly')).toHaveValue('')
  expect(container.querySelector('.ai-workspace')).not.toHaveClass('history-mobile-open')
  expect(container.querySelector('.ai-history-item')).toHaveClass('selected')
  expect(window.localStorage.getItem('budgetly-chat-history-collapsed')).toBeNull()
})
