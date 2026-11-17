import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import WindowsUpdate from './WindowsUpdate'
import { fetchWindowsRelease } from '../lib/appUpdates'

vi.mock('../lib/appUpdates', () => ({ fetchWindowsRelease: vi.fn(), newerVersion: () => true }))

const installer = 'https://github.com/Omars64/Budget-Planner/releases/download/v9.0.0/Budgetly-Setup-9.0.0.exe'
const release = { version: '9.0.0', size: 2000000, url: installer }

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.resetAllMocks()
})

test.each([false, undefined])('unverified release (signed=%s) offers only the official installer download', async signed => {
  fetchWindowsRelease.mockResolvedValue({ ...release, signed })
  const installUpdate = vi.fn()
  const canInstallUpdate = vi.fn().mockResolvedValue(true)
  vi.stubGlobal('budgetlyDesktop', { version: '8.0.0', canInstallUpdate, installUpdate })
  render(<WindowsUpdate/>)
  expect(await screen.findByRole('link', { name: 'Download Windows installer' })).toHaveAttribute('href', installer)
  expect(screen.queryByRole('button', { name: 'Update and restart' })).toBeNull()
  expect(canInstallUpdate).not.toHaveBeenCalled()
  expect(installUpdate).not.toHaveBeenCalled()
})

test('an older unsigned installation can download the first signed update', async () => {
  fetchWindowsRelease.mockResolvedValue({ ...release, signed: true })
  const installUpdate = vi.fn()
  vi.stubGlobal('budgetlyDesktop', { version: '8.0.0', canInstallUpdate: async () => false, installUpdate })
  render(<WindowsUpdate/>)
  expect(await screen.findByRole('link', { name: 'Download Windows installer' })).toHaveAttribute('href', installer)
  expect(screen.getByText(/run this signed installer once/)).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Update and restart' })).toBeNull()
  expect(installUpdate).not.toHaveBeenCalled()
})

test('a trusted release installs in the app and reports download progress', async () => {
  fetchWindowsRelease.mockResolvedValue({ ...release, signed: true })
  let report
  const installUpdate = vi.fn(() => new Promise(() => {}))
  vi.stubGlobal('budgetlyDesktop', {
    version: '8.0.0', canInstallUpdate: async () => true, installUpdate,
    onUpdateProgress: callback => { report = callback; return () => {} },
  })
  render(<WindowsUpdate/>)
  fireEvent.click(await screen.findByRole('button', { name: 'Update and restart' }))
  expect(installUpdate).toHaveBeenCalledWith('9.0.0')
  expect(screen.queryByRole('link', { name: 'Download Windows installer' })).toBeNull()
  act(() => report({ phase: 'downloading', percentage: 42 }))
  expect(screen.getByRole('progressbar', { name: 'Windows update download' })).toHaveAttribute('value', '42')
  act(() => report({ phase: 'verifying' }))
  expect(screen.getByRole('status')).toHaveTextContent('Verifying the publisher signature')
})

test('a publisher verification failure stops the signed update and allows retrying', async () => {
  fetchWindowsRelease.mockResolvedValue({ ...release, signed: true })
  const error = 'Windows could not verify the installer against the installed publisher.'
  vi.stubGlobal('budgetlyDesktop', { version: '8.0.0', canInstallUpdate: async () => true, installUpdate: async () => ({ error }) })
  render(<WindowsUpdate/>)
  fireEvent.click(await screen.findByRole('button', { name: 'Update and restart' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(error)
  expect(screen.queryByRole('link', { name: 'Download Windows installer' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Update and restart' })).toBeEnabled()
})

test('the Store channel leaves update delivery to Windows', () => {
  vi.stubGlobal('budgetlyDesktop', { updateChannel: 'store' })
  render(<WindowsUpdate/>)
  expect(fetchWindowsRelease).not.toHaveBeenCalled()
})

test('Check updates in Settings can reopen an update dismissed earlier', async () => {
  fetchWindowsRelease.mockResolvedValue({ ...release, signed: true })
  vi.stubGlobal('budgetlyDesktop', { version: '8.0.0', canInstallUpdate: async () => true, installUpdate: vi.fn() })
  const key = 'budgetly-windows-update-dismissed-9.0.0'
  sessionStorage.setItem(key, 'yes')
  try {
    render(<WindowsUpdate settings/>)
    await waitFor(() => expect(fetchWindowsRelease).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Check updates' }))
    expect(await screen.findByRole('button', { name: 'Update and restart' })).toBeEnabled()
    expect(fetchWindowsRelease).toHaveBeenCalledTimes(2)
  } finally {
    sessionStorage.removeItem(key)
  }
})
