import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import AssistantSettings from './AssistantSettings'
import { api } from '../lib/api'

vi.mock('../App', () => ({ useApp: () => ({ notify: vi.fn(), confirm: vi.fn() }) }))
vi.mock('../lib/api', () => ({ api: vi.fn(), jsonBody: data => ({ body: JSON.stringify(data) }) }))
afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  api.mockResolvedValue({ enabled: true, configured: true, model_valid: true, available: true, model: 'gpt-4o-mini' })
})

it('shows a safe connection result and does not send workspace data', async () => {
  render(<AssistantSettings/>)
  const button = screen.getByRole('button', { name: 'Test AI connection' })
  await waitFor(() => expect(button).toBeEnabled())
  api.mockResolvedValueOnce({ ok: false, reason: 'quota', message: 'Check OpenAI billing and limits.' })
  fireEvent.click(button)
  expect(await screen.findByRole('status')).toHaveTextContent('Check OpenAI billing and limits.')
  expect(api).toHaveBeenLastCalledWith('/api/admin/assistant/check', { method: 'POST' })
})

it('does not allow a probe when AI is disabled', async () => {
  api.mockResolvedValue({ enabled: false, configured: true, model_valid: true, available: false, model: 'gpt-4o-mini' })
  render(<AssistantSettings/>)
  await screen.findByText(/AI key|API key is present/)
  expect(screen.getByRole('button', { name: 'Test AI connection' })).toBeDisabled()
})
