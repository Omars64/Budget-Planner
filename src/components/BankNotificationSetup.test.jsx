import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import BankNotificationSetup from './BankNotificationSetup'
const mocks = vi.hoisted(() => ({
  bindSession: vi.fn(async () => {}),
  isNotificationAccessGranted: vi.fn(async () => ({ granted: false })),
  getAllowedPackages: vi.fn(async () => ({ packages: ['bank.app'] })),
  getInstalledCandidateApps: vi.fn(async () => ({ apps: [{ packageName: 'bank.app', label: 'Bank App' }] })),
}))
vi.mock('../App', () => ({ useApp: () => ({ user: { id: 1 }, spaces: [], notify: vi.fn() }) }))
vi.mock('../lib/api', () => ({ api: vi.fn(async () => []), jsonBody: value => value }))
vi.mock('../lib/bankNotifications/native', () => ({ BankNotifications: mocks, bankNotificationsAvailable: () => true, syncBankNotifications: vi.fn() }))
afterEach(() => { cleanup(); vi.clearAllMocks() })
it('restores the account session before reading saved selections and warns about revoked access', async () => {
  render(<BankNotificationSetup/>)
  expect(await screen.findByRole('alert')).toHaveTextContent('Your selected apps are saved')
  expect(screen.getByRole('checkbox')).toBeChecked()
  expect(mocks.bindSession).toHaveBeenCalledWith({ owner: '1' })
  expect(mocks.bindSession.mock.invocationCallOrder[0]).toBeLessThan(mocks.getAllowedPackages.mock.invocationCallOrder[0])
})
