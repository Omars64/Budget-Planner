import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import AppShell from './AppShell'

vi.mock('../App', () => ({ useApp: () => ({
  user: { id: 1, username: 'Omar', role: 'user' },
  settings: { display_name: 'Budgetly' }, appearance: {},
  refresh: vi.fn(), notify: vi.fn(), lock: vi.fn(),
}) }))
vi.mock('./TransactionModal', () => ({ default: () => null }))
vi.mock('./AppTutorial', () => ({ default: () => null }))
vi.mock('./Milestone', () => ({ default: () => null }))
vi.mock('./ConnectionStatus', () => ({ default: () => null }))
vi.mock('./ScrollMemory', () => ({ default: () => null }))
vi.mock('../lib/scrollLock', () => ({ useContainedScroll: vi.fn(), useScrollLock: vi.fn() }))

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  vi.stubGlobal('requestAnimationFrame', callback => callback())
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

test('page finder filters grouped navigation and Ctrl+K focuses it', () => {
  render(<MemoryRouter initialEntries={['/']}><AppShell><p>Page</p></AppShell></MemoryRouter>)
  const finder = screen.getByRole('searchbox', { name: 'Find a page' })
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
  expect(finder).toHaveFocus()
  fireEvent.change(finder, { target: { value: 'notes' } })
  expect(screen.getByRole('link', { name: 'Notes' })).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Calendar' })).not.toBeInTheDocument()
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(finder).toHaveValue('')
})

test('More is active for secondary pages but not a primary tab', () => {
  const { rerender } = render(<MemoryRouter initialEntries={['/notes']}><AppShell/></MemoryRouter>)
  expect(screen.getByRole('button', { name: 'More' })).toHaveAttribute('aria-current', 'page')
  rerender(<MemoryRouter initialEntries={['/']} key="overview"><AppShell/></MemoryRouter>)
  expect(screen.getByRole('button', { name: 'More' })).not.toHaveAttribute('aria-current')
})
