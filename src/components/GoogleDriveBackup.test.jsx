import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import GoogleDriveBackup from './GoogleDriveBackup'

const mocks = vi.hoisted(() => ({ api: vi.fn(), apiFile: vi.fn(), save: vi.fn(), reserve: vi.fn(), open: vi.fn(), confirm: vi.fn(), popup: { close: vi.fn() } }))
vi.mock('../lib/api', () => ({ api: mocks.api, apiFile: mocks.apiFile, jsonBody: value => ({ body: JSON.stringify(value) }) }))
vi.mock('../lib/download', () => ({ saveDownload: mocks.save }))
vi.mock('../lib/googleFlow', () => ({ reserveGoogleWindow: mocks.reserve, openGoogleFlow: mocks.open }))
vi.mock('./Confirmation', () => ({ useConfirmation: () => ({ confirm: mocks.confirm, confirmation: null }) }))

beforeEach(() => {
  vi.resetAllMocks()
  mocks.reserve.mockReturnValue(mocks.popup)
  mocks.api.mockImplementation(async path => path.endsWith('/status') ? { configured: true, connected: false } : { files: [] })
})
afterEach(cleanup)

const expand = () => {
  const view = render(<GoogleDriveBackup/> )
  const details = view.container.querySelector('details')
  details.open = true
  fireEvent(details, new Event('toggle'))
  return view
}

test('loads only when expanded and prevents connecting when configuration is unavailable', async () => {
  mocks.api.mockResolvedValue({ configured: false, connected: false })
  const view = render(<GoogleDriveBackup/> )
  expect(mocks.api).not.toHaveBeenCalled()
  const details = view.container.querySelector('details')
  details.open = true
  fireEvent(details, new Event('toggle'))
  expect(await screen.findByText('Not configured')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Connect Google Drive' })).toBeNull()
  expect(mocks.reserve).not.toHaveBeenCalled()
})

test('reserves browser before starting, passes poll credentials, and aborts on unmount', async () => {
  const flow = { authorization_url: 'https://accounts.google.com/oauth', flow_id: 'flow', poll_secret: 'secret' }
  mocks.api.mockImplementation(async path => path.endsWith('/start') ? flow : { configured: true, connected: false })
  mocks.open.mockImplementation(() => new Promise(() => {}))
  const view = expand()
  fireEvent.click(await screen.findByRole('button', { name: 'Connect Google Drive' }))
  await waitFor(() => expect(mocks.open).toHaveBeenCalled())
  expect(mocks.reserve.mock.invocationCallOrder[0]).toBeLessThan(mocks.api.mock.invocationCallOrder[1])
  const options = mocks.open.mock.calls[0][1]
  expect(options.pollBody).toEqual({ flow_id: 'flow', poll_secret: 'secret' })
  expect(options.pollPath).toBe('/api/google-drive/poll')
  expect(options.signal.aborted).toBe(false)
  view.unmount()
  expect(options.signal.aborted).toBe(true)
  expect(mocks.api).toHaveBeenCalledWith('/api/google-drive/cancel', { method: 'POST', body: JSON.stringify({ flow_id: 'flow', poll_secret: 'secret' }) })
})

test('cancel waiting aborts polling and leaves reload available', async () => {
  mocks.api.mockImplementation(async path => path.endsWith('/start') ? { flow_id: 'flow', poll_secret: 'secret', authorization_url: 'https://accounts.google.com/oauth' } : { configured: true, connected: false })
  mocks.open.mockImplementation(() => new Promise(() => {}))
  expand()
  fireEvent.click(await screen.findByRole('button', { name: 'Connect Google Drive' }))
  await waitFor(() => expect(mocks.open).toHaveBeenCalled())
  fireEvent.click(screen.getByRole('button', { name: 'Cancel waiting' }))
  expect(mocks.open.mock.calls[0][1].signal.aborted).toBe(true)
  expect(mocks.api).toHaveBeenCalledWith('/api/google-drive/cancel', expect.objectContaining({ method: 'POST' }))
  expect(screen.getByRole('button', { name: 'Reload Google Drive connection' })).not.toBeDisabled()
})

test('downloads JSON using existing helpers and requires confirmation to disconnect', async () => {
  mocks.api.mockImplementation(async path => path.endsWith('/status') ? { configured: true, connected: true } : { files: [{ id: 'file-id', name: 'backup.json' }] })
  const blob = new Blob(['{}'], { type: 'application/json' })
  mocks.apiFile.mockResolvedValue(blob)
  mocks.confirm.mockResolvedValue(false)
  expand()
  fireEvent.click(await screen.findByRole('button', { name: 'Download backup.json' }))
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(blob, 'backup.json'))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Disconnect' })).not.toBeDisabled())
  fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalled())
  expect(mocks.api.mock.calls.some(([path]) => path.endsWith('/disconnect'))).toBe(false)
  await act(async () => {})
  mocks.confirm.mockResolvedValue(true)
  fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
  await waitFor(() => expect(mocks.api).toHaveBeenCalledWith('/api/google-drive/disconnect', expect.objectContaining({ method: 'POST' })))
  expect(mocks.api.mock.calls.some(([path]) => path.includes('restore'))).toBe(false)
})

test('loads additional backups with the returned page token', async () => {
  mocks.api.mockImplementation(async path => {
    if (path.endsWith('/status')) return { configured: true, connected: true }
    if (path.includes('page_token=')) return { files: [{ id: 'second', name: 'second.json' }] }
    return { files: [{ id: 'first', name: 'first.json' }], next_page_token: 'next/token' }
  })
  expand()
  fireEvent.click(await screen.findByRole('button', { name: 'Load more backups' }))
  expect(await screen.findByRole('button', { name: 'Download second.json' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Download first.json' })).toBeInTheDocument()
  expect(mocks.api).toHaveBeenCalledWith('/api/google-drive/files?page_token=next%2Ftoken', expect.anything())
  expect(screen.queryByRole('button', { name: 'Load more backups' })).toBeNull()
})

test('invalidates a flow when its start response arrives after unmount', async () => {
  let resolveStart
  mocks.api.mockImplementation(path => path.endsWith('/start')
    ? new Promise(resolve => { resolveStart = resolve })
    : Promise.resolve({ configured: true, connected: false }))
  const view = expand()
  fireEvent.click(await screen.findByRole('button', { name: 'Connect Google Drive' }))
  view.unmount()
  await act(async () => resolveStart({ flow_id: 'late', poll_secret: 'secret', authorization_url: 'https://accounts.google.com/oauth' }))
  expect(mocks.api).toHaveBeenCalledWith('/api/google-drive/cancel', { method: 'POST', body: JSON.stringify({ flow_id: 'late', poll_secret: 'secret' }) })
  expect(mocks.open).not.toHaveBeenCalled()
  expect(mocks.popup.close).toHaveBeenCalled()
})

test('shows failed authorization instead of reporting a successful connection', async () => {
  mocks.api.mockImplementation(async path => path.endsWith('/start') ? { flow_id: 'flow', poll_secret: 'secret', authorization_url: 'https://accounts.google.com/oauth' } : { configured: true, connected: false })
  mocks.open.mockResolvedValue({ status: 'failed', connected: false })
  expand()
  fireEvent.click(await screen.findByRole('button', { name: 'Connect Google Drive' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('connection was not completed')
  expect(screen.queryByText('Google Drive connected.')).toBeNull()
})
