import { useEffect, useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import AppTutorial from './AppTutorial'

const state = vi.hoisted(() => ({ config: null, driver: null, steps: [], notify: vi.fn() }))
vi.mock('../App', () => ({ useApp: () => ({ user: { id: 101, role: 'user' }, notify: state.notify }) }))
vi.mock('../lib/api', () => ({ api: vi.fn(async () => ({ status: 'completed' })), jsonBody: value => ({ body: JSON.stringify(value) }) }))
vi.mock('../lib/tutorialSteps', () => ({ tutorialSteps: () => state.steps }))
vi.mock('driver.js', () => ({ driver: config => {
  state.config = config
  state.driver = {
    drive: vi.fn(index => {
      const step = config.steps[index]
      step.onHighlighted(step.element())
    }),
    refresh: vi.fn(),
    destroy: vi.fn(() => config.onDestroyed()),
  }
  return state.driver
} }))

beforeEach(() => {
  window.localStorage.clear()
  state.config = null
  state.driver = null
  state.notify.mockReset()
  state.steps = ['Personal preferences', 'Backup & restore'].map(section => ({ route: '/settings', section, title: section, description: section }))
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  // jsdom has no layout; model hidden ancestors as having no rendered boxes.
  vi.spyOn(window.HTMLElement.prototype, 'getClientRects').mockImplementation(function () {
    return this.closest('[hidden], [style*="display: none"]') ? [] : [{ width: 100, height: 30 }]
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function startTour(workspace) {
  render(<MemoryRouter>{workspace}<AppTutorial request={1}/></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Start tutorial' }))
  await waitFor(() => expect(state.driver?.drive).toHaveBeenCalledWith(0))
}

test('settings events reveal inline section headings when moving forward and back between categories', async () => {
  const opened = vi.fn()
  function Workspace() {
    const { pathname } = useLocation()
    const [section, setSection] = useState('')
    useEffect(() => {
      const open = event => {
        opened(pathname, event.detail)
        setSection(event.detail.section)
      }
      window.addEventListener('budgetly:settings-open', open)
      return () => window.removeEventListener('budgetly:settings-open', open)
    }, [pathname])
    return <main className="page-wrap" data-tour-page={pathname}>
      {state.steps.map(step => <div key={step.section} data-settings-group={step.section} hidden={section !== step.section}>
        <section className="settings-section"><h2 data-tour-section={step.section}>{step.section}</h2></section>
      </div>)}
    </main>
  }

  await startTour(<Workspace/>)
  expect(opened).toHaveBeenCalledWith('/settings', { section: 'Personal preferences' })
  const first = state.config.steps[0].element()
  expect(first.tagName).toBe('H2')
  expect(first).toBeVisible()

  act(() => state.config.onNextClick(null, null, { index: 0 }))
  await waitFor(() => expect(state.driver.drive).toHaveBeenLastCalledWith(1))
  expect(opened).toHaveBeenCalledWith('/settings', { section: 'Backup & restore' })
  expect(state.config.steps[0].element()).toBeUndefined()
  expect(state.config.steps[1].element()).toBeVisible()

  act(() => state.config.onPrevClick(null, null, { index: 1 }))
  await waitFor(() => expect(state.driver.drive).toHaveBeenLastCalledWith(0))
  expect(first).toBeVisible()
  expect(state.config.steps[1].element()).toBeUndefined()
  expect(state.notify).not.toHaveBeenCalled()
})

test('settings navigation retries until its listener reveals a visible target', async () => {
  state.steps = [state.steps[0]]
  const opened = vi.fn()
  function Workspace() {
    const { pathname } = useLocation()
    const [revealed, setRevealed] = useState(false)
    useEffect(() => {
      const open = event => {
        opened(event.detail)
        if (opened.mock.calls.length < 3) {
          expect(state.driver.drive).not.toHaveBeenCalled()
          return
        }
        setRevealed(true)
      }
      window.addEventListener('budgetly:settings-open', open)
      return () => window.removeEventListener('budgetly:settings-open', open)
    }, [])
    return <main className="page-wrap" data-tour-page={pathname}>
      <div data-settings-group="hidden" hidden><h2 data-tour-section="Personal preferences">Hidden duplicate</h2></div>
      <h2 data-tour-section="Personal preferences" style={{ visibility: 'hidden' }}>Invisible duplicate</h2>
      <div data-settings-group="appearance" style={{ display: revealed ? 'block' : 'none' }}>
        <h2 data-tour-section="Personal preferences">Visible preferences</h2>
      </div>
    </main>
  }

  await startTour(<Workspace/>)
  expect(opened.mock.calls.length).toBeGreaterThanOrEqual(3)
  expect(state.config.steps[0].element()).toBe(screen.getByText('Visible preferences'))
  expect(state.notify).not.toHaveBeenCalled()
})

test.each([true, false])('legacy admin summaries remain targetable and open their accordion (marker: %s)', async marked => {
  state.steps = [{ route: '/admin', section: 'Service health', title: 'Health', description: 'Health' }]
  const opened = vi.fn()
  window.addEventListener('budgetly:settings-open', opened)
  function Workspace() {
    const { pathname } = useLocation()
    return <main className="page-wrap" data-tour-page={pathname}>
      <details className="settings-section" hidden><summary data-tour-section="Service health">Hidden duplicate</summary></details>
      <details className="settings-section">
        <summary data-tour-section={marked ? 'Service health' : undefined}>{marked ? 'Health status' : '  SERVICE   health  '}</summary>
        <p>Service details</p>
      </details>
    </main>
  }

  try {
    await startTour(<Workspace/>)
    const target = state.config.steps[0].element()
    expect(target.tagName).toBe('SUMMARY')
    expect(target.parentElement.open).toBe(true)
    expect(opened).not.toHaveBeenCalled()
  } finally {
    window.removeEventListener('budgetly:settings-open', opened)
  }
})
