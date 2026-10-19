import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import SupportPrompt from './SupportPrompt'
import { dismissSupport, resetSupportPrompt, supportDismissed } from '../lib/support'

beforeEach(() => { vi.useFakeTimers(); resetSupportPrompt(704); sessionStorage.clear() })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })
const ready = () => act(() => { vi.advanceTimersByTime(1300) })

it('stays dismissed across page/Space remounts and returns after a fresh sign-in reset', () => {
  const view = render(<SupportPrompt userId={704}/> )
  ready()
  expect(screen.getByRole('region', { name: 'Enjoying Budgetly?' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Buy me a coffee' })).toHaveAttribute('href', 'https://ko-fi.com/omarsolanki')
  fireEvent.click(screen.getByRole('button', { name: 'Close support prompt' }))
  expect(screen.queryByRole('region')).not.toBeInTheDocument()
  view.unmount()
  const remounted = render(<SupportPrompt userId={704}/> )
  ready()
  expect(screen.queryByRole('region')).not.toBeInTheDocument()
  remounted.unmount()
  resetSupportPrompt(704)
  render(<SupportPrompt userId={704}/> )
  ready()
  expect(screen.getByRole('region')).toBeInTheDocument()
})

it('pauses for menus, keyboards and guests without counting suppression as dismissal', () => {
  const view = render(<SupportPrompt userId={704} suppressed/> )
  ready()
  expect(screen.queryByRole('region')).not.toBeInTheDocument()
  view.rerender(<SupportPrompt userId={704}/> )
  expect(screen.getByRole('region')).toBeInTheDocument()
  view.rerender(<SupportPrompt userId={704} guest/> )
  expect(screen.queryByRole('region')).not.toBeInTheDocument()
  expect(supportDismissed(704)).toBe(false)
})

it('yields to dialogs and comes back when they close', async () => {
  render(<SupportPrompt userId={704}/> )
  ready()
  const modal = document.createElement('div')
  modal.setAttribute('aria-modal', 'true')
  await act(async () => { document.body.appendChild(modal) })
  expect(screen.queryByRole('region')).not.toBeInTheDocument()
  await act(async () => { modal.remove() })
  expect(screen.getByRole('region')).toBeInTheDocument()
})

it('can be closed even when browser storage is unavailable', () => {
  vi.spyOn(window.Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage unavailable') })
  dismissSupport(704)
  expect(supportDismissed(704)).toBe(true)
  resetSupportPrompt(704)
  expect(supportDismissed(704)).toBe(false)
})
