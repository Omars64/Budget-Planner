import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import Experience from './Experience'

const app = vi.hoisted(() => ({ user: { id: 1 }, settings: {}, notify: vi.fn() }))
vi.mock('../App', () => ({ useApp: () => app }))
vi.mock('./ResizablePanels', () => ({ default: () => null }))
vi.mock('./SecurityPrompt', () => ({ default: () => null }))
vi.mock('../lib/bankSms', () => ({ syncBankSms: () => Promise.resolve() }))
vi.mock('../lib/deviceNotifications', () => ({ isNativeApp: () => false, quietAt: vi.fn(), reminderBody: vi.fn(), reminderTimes: vi.fn(), configureReminder: vi.fn() }))
vi.mock('../lib/notificationSettings', () => ({ notificationSettingsChangedEvent: 'settings-changed', readNotificationSettings: () => ({ reminders_enabled: false }) }))

afterEach(cleanup)

test('an ongoing background write does not block another form', () => {
  const submit = vi.fn(event => event.preventDefault())
  render(<MemoryRouter><Experience/><form onSubmit={submit}><button>Submit</button></form></MemoryRouter>)
  fireEvent(window, new CustomEvent('flowbudget:pending', { detail: 1 }))
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
  expect(submit).toHaveBeenCalledOnce()
  fireEvent(window, new CustomEvent('flowbudget:pending', { detail: 0 }))
})
