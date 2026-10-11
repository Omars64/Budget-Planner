import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import AIConversation from './AIConversation'

afterEach(cleanup)

const turn = { id: 'turn-1', question: 'My spending?', created_at: '2026-10-01T10:00:00Z', status: 'completed', answer: '**Review** your spending.\n\n- `Food`\n- https://example.com', sources: [{ key: 'record', label: 'Expense record', kind: 'transaction', id: 4 }], suggestions: ['Plan next month'] }
const props = () => ({ messagesRef: { current: null }, onPrompt: vi.fn(), onEarlier: vi.fn(), onRetry: vi.fn(), onUseDraft: vi.fn(), onSource: vi.fn(), onSaveNote: vi.fn(), onFeedback: vi.fn(), notify: vi.fn(), selectedScope: 'personal', wallets: [] })

it('renders answers and dispatches pagination, record, note, feedback and follow-up actions', () => {
  const actions = props()
  render(<AIConversation {...actions} chat={{ has_more: true, turns: [turn] }}/>)
  expect(screen.getByRole('log', { name: 'Conversation' })).toHaveAttribute('aria-live', 'polite')
  expect(screen.getByText('Review').tagName).toBe('STRONG')
  expect(screen.getByText('Food').tagName).toBe('CODE')
  expect(screen.getByRole('link')).toHaveAttribute('rel', 'noopener noreferrer')
  fireEvent.click(screen.getByText('Earlier messages'))
  expect(actions.onEarlier).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByText('Sources & records (1)'))
  fireEvent.click(screen.getByText('Expense record'))
  expect(actions.onSource).toHaveBeenCalledWith(turn.sources[0])
  fireEvent.click(screen.getByLabelText('Save answer to Notes'))
  expect(actions.onSaveNote).toHaveBeenCalledWith(turn)
  fireEvent.click(screen.getByLabelText('Helpful answer'))
  expect(actions.onFeedback).toHaveBeenCalledWith(turn, 'helpful')
  fireEvent.click(screen.getByLabelText('Report incorrect answer'))
  expect(actions.onFeedback).toHaveBeenCalledWith(turn, 'incorrect')
  fireEvent.click(screen.getByText('Plan next month'))
  expect(actions.onPrompt).toHaveBeenCalledWith('Plan next month')
})

it('keeps retry, saved-note, pending and shared view-only draft guards', () => {
  const actions = props()
  const chat = { turns: [{ ...turn, status: 'failed', note_id: 7, feedback: 'helpful', drafts: [{ type: 'expense', amount: '5' }] }] }
  const { rerender } = render(<AIConversation {...actions} chat={chat} selectedScope="shared" selectedWallet="1" wallets={[{ id: 1, permission: 'view' }]}/> )
  expect(screen.getByText('View-only access')).toBeDisabled()
  expect(screen.getByLabelText('Save answer to Notes')).toBeDisabled()
  expect(screen.getByLabelText('Helpful answer')).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(screen.getByText('Retry'))
  expect(actions.onRetry).toHaveBeenCalledWith(expect.anything(), turn.id)
  rerender(<AIConversation {...actions} chat={chat} pending acting sending/> )
  expect(screen.getByText('Retry')).toBeDisabled()
  expect(screen.getByLabelText('Helpful answer')).toBeDisabled()
  expect(screen.getByText('Plan next month')).toBeDisabled()
  expect(screen.getByRole('status')).toHaveTextContent('Sending your question...')
})
