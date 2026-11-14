import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import WindowsUpdate from './WindowsUpdate'
import { fetchWindowsRelease } from '../lib/appUpdates'

vi.mock('../lib/appUpdates', () => ({ fetchWindowsRelease: vi.fn(), newerVersion: () => true }))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.resetAllMocks()
})

test('an unsigned release offers no download link or install action', async () => {
  fetchWindowsRelease.mockResolvedValue({ version: '9.0.0', signed: false, size: 2000000 })
  const installUpdate = vi.fn()
  vi.stubGlobal('budgetlyDesktop', { version: '8.0.0', installUpdate })
  render(<WindowsUpdate/>)
  await waitFor(() => expect(screen.getByText(/missing a verified Windows publisher/)).toBeVisible())
  expect(screen.queryByRole('link')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Update and restart' })).toBeNull()
  expect(installUpdate).not.toHaveBeenCalled()
})

test('a trusted release installs in the app and reports download progress', async () => {
  fetchWindowsRelease.mockResolvedValue({ version: '9.0.0', signed: true, size: 2000000 })
  let report
  const installUpdate = vi.fn(() => new Promise(() => {}))
  vi.stubGlobal('budgetlyDesktop', {
    version: '8.0.0', canInstallUpdate: async () => true, installUpdate,
    onUpdateProgress: callback => { report = callback; return () => {} },
  })
  render(<WindowsUpdate/>)
  fireEvent.click(await screen.findByRole('button', { name: 'Update and restart' }))
  expect(installUpdate).toHaveBeenCalledWith('9.0.0')
  act(() => report({ phase: 'downloading', percentage: 42 }))
  expect(screen.getByRole('progressbar', { name: 'Windows update download' })).toHaveAttribute('value', '42')
  act(() => report({ phase: 'verifying' }))
  expect(screen.getByRole('status')).toHaveTextContent('Verifying the publisher signature')
})

test('the Store channel leaves update delivery to Windows', () => {
  vi.stubGlobal('budgetlyDesktop', { updateChannel: 'store' })
  render(<WindowsUpdate/>)
  expect(fetchWindowsRelease).not.toHaveBeenCalled()
})

test('Check updates in Settings can reopen an update dismissed earlier', async () => {
  fetchWindowsRelease.mockResolvedValue({ version: '9.1.0', signed: true, size: 2000000 })
  vi.stubGlobal('budgetlyDesktop', { version: '8.0.0', canInstallUpdate: async () => true })
  const key = 'budgetly-windows-update-dismissed-9.1.0'
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
