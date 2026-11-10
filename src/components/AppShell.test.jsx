import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import AppShell from './AppShell'

const preferences = vi.hoisted(() => ({role:'user', sidebar:true}))
vi.mock('../App', () => ({ useApp: () => ({
  user: { id: 1, username: 'Omar', role: preferences.role },
  settings: { display_name: 'Budgetly', support_sidebar_enabled: preferences.sidebar }, appearance: {},
  refresh: vi.fn(), notify: vi.fn(), lock: vi.fn(),
}) }))
vi.mock('./TransactionModal', () => ({ default: () => null }))
vi.mock('./AppTutorial', () => ({ default: () => null }))
vi.mock('./Milestone', () => ({ default: () => null }))
vi.mock('./ConnectionStatus', () => ({ default: () => null }))
vi.mock('./ScrollMemory', () => ({ default: () => null }))
vi.mock('../lib/scrollLock', () => ({ useContainedScroll: vi.fn(), useScrollLock: vi.fn() }))

beforeEach(() => {
  preferences.role = 'user'; preferences.sidebar = true
  localStorage.removeItem('budgetly-sidebar-collapsed')
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  vi.stubGlobal('requestAnimationFrame', callback => callback())
})

test('current account appears in the shared header, while sidebar sign-out stays separate', () => {
  render(<MemoryRouter><AppShell/></MemoryRouter>)
  expect(within(screen.getByRole('banner')).getByRole('link', {name:'Account and preferences'})).toHaveAttribute('title', 'Omar')
  expect(within(screen.getByRole('banner')).queryByRole('button', {name:'Sign out'})).not.toBeInTheDocument()
  expect(within(document.querySelector('.sidebar')).getByRole('button', {name:'Sign out'})).toBeInTheDocument()
  expect(document.querySelector('.sidebar-foot')).toBeNull()
})

test('only admins can hide their own sidebar link', () => {
  preferences.role = 'admin'; preferences.sidebar = false
  const view = render(<MemoryRouter><AppShell/></MemoryRouter>)
  expect(document.querySelector('.sidebar-support-link')).toBeNull()
  preferences.role = 'user'
  view.rerender(<MemoryRouter><AppShell/></MemoryRouter>)
  expect(document.querySelector('.sidebar-support-link')).toBeInTheDocument()
})

test('desktop sidebar collapse is saved and page finder expands it', () => {
  render(<MemoryRouter><AppShell/></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', {name:'Collapse sidebar'}))
  expect(document.querySelector('.app-shell')).toHaveClass('sidebar-collapsed')
  expect(localStorage.getItem('budgetly-sidebar-collapsed')).toBe('true')
  expect(screen.getByRole('link', {name:'Calendar'})).toBeInTheDocument()
  expect(screen.getByRole('link', {name:'Spaces'})).toBeInTheDocument()
  fireEvent.keyDown(window, {key:'k',ctrlKey:true})
  expect(document.querySelector('.app-shell')).not.toHaveClass('sidebar-collapsed')
  expect(screen.getByRole('searchbox', {name:'Find a page'})).toHaveFocus()
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
  expect(screen.getByRole('link', { name: 'More tools' })).toHaveAttribute('aria-current', 'page')
  rerender(<MemoryRouter initialEntries={['/']} key="overview"><AppShell/></MemoryRouter>)
  expect(screen.getByRole('link', { name: 'More tools' })).not.toHaveAttribute('aria-current')
})

test('the highlighted support link stays at the sidebar bottom when filtered or collapsed', () => {
  render(<MemoryRouter><AppShell/></MemoryRouter>)
  const sidebar = within(document.querySelector('.sidebar'))
  fireEvent.change(screen.getByRole('searchbox', { name: 'Find a page' }), { target: { value: 'does not exist' } })
  const link = sidebar.getByRole('link', { name: 'Buy me a coffee', exact: true })
  expect(link).toHaveAttribute('href', 'https://ko-fi.com/omarsolanki')
  expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  expect(link.closest('.nav-list')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
  expect(link).toBeInTheDocument()
  expect(link).toHaveAttribute('title', 'Buy me a coffee - support Budgetly')
})


test('page search still finds less-used tools and the mobile More link navigates', () => {
  render(<MemoryRouter><AppShell/></MemoryRouter>)
  expect(screen.getByRole('link', {name:'More tools'})).toHaveAttribute('href', '/more')
  fireEvent.change(screen.getByRole('searchbox', {name:'Find a page'}), {target:{value:'calendar'}})
  expect(screen.getByRole('link', {name:'Calendar'})).toHaveAttribute('href', '/calendar')
})
