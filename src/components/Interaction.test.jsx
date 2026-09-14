import { useRef, useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import AccentPicker from './AccentPicker'
import Modal from './Modal'
import AppTutorial from './AppTutorial'
import { lockPageScroll, useContainedScroll } from '../lib/scrollLock'
import { tutorialSteps } from '../lib/tutorialSteps'

const state = vi.hoisted(() => ({ api: vi.fn(), notify: vi.fn(), config: null, driver: null }))
vi.mock('../App', () => ({ useApp: () => ({ user: { id: 101, role: 'user' }, notify: state.notify }) }))
vi.mock('../lib/api', () => ({ api: (...args) => state.api(...args), jsonBody: value => ({ body: JSON.stringify(value) }) }))
vi.mock('driver.js', () => ({ driver: config => {
  state.config = config
  state.driver = { drive: vi.fn(), refresh: vi.fn(), destroy: vi.fn(() => config.onDestroyed()) }
  return state.driver
} }))

beforeEach(() => {
  window.localStorage.clear()
  state.api.mockReset().mockImplementation((_, options) => Promise.resolve(options?.body ? JSON.parse(options.body) : { status: 'not_started' }))
  state.notify.mockReset()
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

test('nested scroll locks restore the original styles only after the last closes', () => {
  document.body.style.overflow = 'auto'
  const first = lockPageScroll(), second = lockPageScroll()
  expect(document.body.style.overflow).toBe('hidden')
  first(); first()
  expect(document.body.style.overflow).toBe('hidden')
  second()
  expect(document.body.style.overflow).toBe('auto')
  expect(document.documentElement.style.overflow).toBe('')
})

test('sidebar wheel events scroll its content but do not chain to the page', () => {
  function Sidebar() { const ref = useRef(null); useContainedScroll(ref); return <aside ref={ref}><nav style={{overflowY:'auto'}} data-testid="nav">Links</nav></aside> }
  render(<Sidebar/>)
  const nav = screen.getByTestId('nav')
  Object.defineProperties(nav, { scrollHeight: { value: 800 }, clientHeight: { value: 200 } })
  nav.scrollTop = 100
  expect(fireEvent.wheel(nav, { deltaY: 100 })).toBe(true)
  nav.scrollTop = 600
  expect(fireEvent.wheel(nav, { deltaY: 100 })).toBe(false)
  nav.scrollTop = 0
  expect(fireEvent.wheel(nav, { deltaY: -100 })).toBe(false)
})

test('Escape closes only the topmost identity prompt and leaves the parent locked', async () => {
  const parent = vi.fn(), child = vi.fn()
  const view = render(<><Modal open onClose={parent} title="Transaction"/><Modal open onClose={child} title="Identity"/></>)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(child).toHaveBeenCalledOnce()
  expect(parent).not.toHaveBeenCalled()
  view.rerender(<Modal open onClose={parent} title="Transaction"/>)
  expect(document.body.style.overflow).toBe('hidden')
  view.unmount()
  expect(document.body.style.overflow).toBe('auto')
})

test('colour changes need Apply; Cancel discards a draft and invalid input is rejected', async () => {
  const onChange = vi.fn()
  render(<AccentPicker value="#0a4173" onChange={onChange}/>)
  fireEvent.click(screen.getByRole('button', { name: 'Accent colour' }))
  fireEvent.change(screen.getByLabelText('Hex colour'), { target: { value: '#ffffff' } })
  expect(onChange).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: 'Accent colour' }))
  expect(screen.getByLabelText('Hex colour')).toHaveValue('#0a4173')
  fireEvent.change(screen.getByLabelText('Hex colour'), { target: { value: '#nope' } })
  expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Hex colour'), { target: { value: '#45aa88' } })
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
  expect(onChange).toHaveBeenCalledExactlyOnceWith('#45aa88')
})

test('new accounts can skip; completed accounts can replay the tutorial', async () => {
  function Demo() { const [request, setRequest] = useState(0); return <MemoryRouter><button onClick={() => setRequest(n => n + 1)}>Replay</button><AppTutorial request={request}/></MemoryRouter> }
  render(<Demo/>)
  fireEvent.click(await screen.findByRole('button', { name: 'Skip for now' }))
  await waitFor(() => expect(state.api).toHaveBeenCalledWith('/api/tutorial', expect.objectContaining({ method: 'PUT', body: '{"status":"skipped"}' })))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  fireEvent.click(screen.getByText('Replay'))
  expect(await screen.findByRole('button', { name: 'Start tutorial' })).toBeInTheDocument()
})

test('tour starts, finishes without financial writes, and can start again', async () => {
  vi.spyOn(window.HTMLElement.prototype, 'getClientRects').mockReturnValue([{ width: 100, height: 100 }])
  const view = render(<MemoryRouter><div className="page-wrap" data-tour-page="/"><section className="hero-strip">Overview</section></div><AppTutorial request={0}/></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Start tutorial' }))
  await waitFor(() => expect(state.driver?.drive).toHaveBeenCalledWith(0))
  act(() => state.config.onDoneClick())
  await waitFor(() => expect(state.api).toHaveBeenCalledWith('/api/tutorial', expect.objectContaining({ body: '{"status":"completed"}' })))
  view.rerender(<MemoryRouter><AppTutorial request={1}/></MemoryRouter>)
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByRole('button', { name: 'Start tutorial' })).toBeEnabled()
  expect(state.api.mock.calls.every(([url]) => url === '/api/tutorial')).toBe(true)
  vi.restoreAllMocks()
})

test('saved completion does not auto-open and admin steps are role-specific', async () => {
  state.api.mockResolvedValue({ status: 'completed' })
  render(<MemoryRouter><AppTutorial request={0}/></MemoryRouter>)
  await act(async () => {})
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(tutorialSteps(false).some(step => step.route === '/admin')).toBe(false)
  expect(tutorialSteps(true).some(step => step.route === '/admin')).toBe(true)
})
