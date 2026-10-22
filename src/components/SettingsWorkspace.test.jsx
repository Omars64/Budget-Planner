import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import SettingsWorkspace from './SettingsWorkspace'
import SettingsSection from './SettingsSection'

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function Preferences() {
  const [draft, setDraft] = useState('Unchanged')
  return <SettingsSection title="Personal preferences"><label>Saved draft<input value={draft} onChange={event => setDraft(event.target.value)}/></label></SettingsSection>
}
function Demo() {
  return <SettingsWorkspace>
    <SettingsSection title="Guest workspace">Account content</SettingsSection>
    <Preferences settingsId="appearance"/>
    <SettingsSection title="Notifications"><label><input type="checkbox"/>Update alerts</label></SettingsSection>
    <SettingsSection title="Currency configuration">Currency content</SettingsSection>
    <div data-testid="outside-dialog">Dialog remains outside category groups</div>
  </SettingsWorkspace>
}

it('uses clear category pages instead of nesting the primary settings in accordions', () => {
  render(<Demo/> )
  expect(screen.getByText('Account content')).toBeVisible()
  expect(screen.getByTestId('outside-dialog')).toBeVisible()
  expect(document.querySelector('details')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /Notifications Updates/ }))
  expect(screen.getByRole('checkbox', { name: 'Update alerts' })).toBeVisible()
  expect(screen.getByText('Account content')).not.toBeVisible()
})

it('keeps drafts and child components mounted while switching categories', () => {
  render(<Demo/> )
  fireEvent.click(screen.getByRole('button', { name: /Look & feel/ }))
  fireEvent.change(screen.getByLabelText('Saved draft'), { target: { value: 'Unsaved text' } })
  fireEvent.click(screen.getByRole('button', { name: /Notifications Updates/ }))
  fireEvent.click(screen.getByRole('button', { name: /Look & feel/ }))
  expect(screen.getByLabelText('Saved draft')).toHaveValue('Unsaved text')
})

it('searches plain-language settings terms and reveals guided-tour targets', () => {
  render(<Demo/> )
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'KWD' } })
  const nav = screen.getByRole('navigation', { name: 'Choose a settings category' })
  expect(within(nav).getAllByRole('button')).toHaveLength(1)
  fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter' })
  expect(screen.getByText('Currency content')).toBeVisible()
  act(() => window.dispatchEvent(new CustomEvent('budgetly:settings-open', { detail: { section: 'Notifications' } })))
  expect(screen.getByRole('checkbox', { name: 'Update alerts' })).toBeVisible()
})

it('uses Android Back to return to settings categories without leaving the page', () => {
  window.matchMedia.mockImplementation(query => ({ matches: query.includes('max-width'), addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  render(<Demo/> )
  fireEvent.click(screen.getByRole('button', { name: /Notifications Updates/ }))
  const back = new Event('budgetly:back', { cancelable: true })
  act(() => window.dispatchEvent(back))
  expect(back.defaultPrevented).toBe(true)
  expect(document.querySelector('.settings-workspace')).toHaveAttribute('data-mobile-detail', 'false')
})

it('leaves Android Back to an open native confirmation or date picker', () => {
  window.matchMedia.mockImplementation(query => ({ matches: query.includes('max-width'), addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  render(<><Demo/><dialog open>Confirm changes</dialog></>)
  fireEvent.click(screen.getByRole('button', { name: /Notifications Updates/ }))
  const back = new Event('budgetly:back', { cancelable: true })
  act(() => window.dispatchEvent(back))
  expect(back.defaultPrevented).toBe(false)
  expect(document.querySelector('.settings-workspace')).toHaveAttribute('data-mobile-detail', 'true')
})

it('a newer category selection supersedes an unfinished outgoing animation', async () => {
  const pending = []
  const animate = vi.fn(() => {
    let resolve
    const finished = new Promise(done => { resolve = done })
    const animation = { finished, cancel: vi.fn() }
    pending.push({ resolve, animation })
    return animation
  })
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
  vi.spyOn(window.HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({width:600,height:400,top:0,left:0,right:600,bottom:400})
  const previousAnimate = window.HTMLElement.prototype.animate
  window.HTMLElement.prototype.animate = animate
  try {
    render(<Demo/> )
    fireEvent.click(screen.getByRole('button', { name: /Look & feel/ }))
    fireEvent.click(screen.getByRole('button', { name: /Notifications Updates/ }))
    await act(async () => { pending[1].resolve(); pending[2].resolve() })
    expect(screen.getByRole('checkbox', { name: 'Update alerts' })).toBeVisible()
    expect(screen.getByLabelText('Saved draft')).not.toBeVisible()
  } finally { window.HTMLElement.prototype.animate = previousAnimate }
})
