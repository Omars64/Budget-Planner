import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import SupportBudgetly from './SupportBudgetly'
import { api } from '../lib/api'

const state = vi.hoisted(() => ({ user: {role:'user'}, settings: {}, setSettings: vi.fn(), notify: vi.fn() }))
vi.mock('../App', () => ({ useApp: () => state }))
vi.mock('../lib/api', () => ({ api: vi.fn(), jsonBody: value => ({body:JSON.stringify(value)}) }))
beforeEach(() => { state.user = {role:'user'}; state.settings = {}; vi.clearAllMocks() })

afterEach(cleanup)

it('keeps optional support collapsed and links only to the verified public page', () => {
  render(<SupportBudgetly/> )
  const section = screen.getByText('Buy me a coffee').closest('details')
  expect(section).not.toHaveAttribute('open')
  fireEvent.click(screen.getByText('Buy me a coffee'))
  const link = screen.getByRole('link', { name: 'Support on Ko-fi' })
  expect(link).toHaveAttribute('href', 'https://ko-fi.com/omarsolanki')
  expect(link).toHaveAttribute('target', '_blank')
  expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  expect(link).toHaveAttribute('referrerpolicy', 'no-referrer')
  expect(section.querySelectorAll('iframe, script')).toHaveLength(0)
  expect(screen.getByRole('switch', {name:'Show support popup after sign-in'})).toBeChecked()
  expect(screen.queryByText('Administrator preferences')).not.toBeInTheDocument()
  expect(screen.getByText(/whether you tip or not/)).toBeInTheDocument()
})

it('saves the personal popup setting without changing any other preferences', async () => {
  api.mockResolvedValue({support_popup_enabled:false})
  render(<SupportBudgetly/> )
  fireEvent.click(screen.getByRole('switch', {name:'Show support popup after sign-in'}))
  await waitFor(() => expect(state.setSettings).toHaveBeenCalled())
  expect(api).toHaveBeenCalledWith('/api/settings', {method:'PUT',body:'{"support_popup_enabled":false}'})
  expect(state.setSettings.mock.calls[0][0]({currency:'USD'})).toEqual({currency:'USD',support_popup_enabled:false})
})

it('shows admins their own sidebar control and preserves the value if saving fails', async () => {
  state.user = {role:'admin'}
  api.mockRejectedValue(new Error('Offline'))
  render(<SupportBudgetly/> )
  const toggle = screen.getByRole('switch', {name:'Show support link in my sidebar'})
  fireEvent.click(toggle)
  await waitFor(() => expect(state.notify).toHaveBeenCalledWith('Offline','error'))
  expect(toggle).toBeChecked()
  expect(toggle).not.toBeDisabled()
  expect(state.setSettings).not.toHaveBeenCalled()
})
