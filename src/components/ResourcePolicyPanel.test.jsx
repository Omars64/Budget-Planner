import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { api } from '../lib/api'
import ResourcePolicyPanel from './ResourcePolicyPanel'

const { confirm } = vi.hoisted(() => ({ confirm: vi.fn() }))
vi.mock('../App', () => ({ useApp: () => ({ confirm }) }))
vi.mock('../lib/api', () => ({ api: vi.fn(), jsonBody: value => ({ body: JSON.stringify(value) }) }))

const policy = { client_poll_seconds: 60, idle_recheck_minutes: 180, database_probe_minutes: 60 }
const fixture = (overrides = {}) => ({ policy: { ...policy }, revision: 'revision-1', coordination: { configured: true, healthy: true }, ...overrides })
const client = () => screen.getByRole('spinbutton', { name: 'Client refresh interval' })
const idle = () => screen.getByRole('spinbutton', { name: 'Idle recovery rescan interval' })
const probe = () => screen.getByRole('spinbutton', { name: 'Database health probe interval' })
const save = () => screen.getByRole('button', { name: 'Save policy' })
const change = (input, value) => fireEvent.change(input, { target: { value: String(value) } })
async function ready(value = fixture()) {
  api.mockResolvedValueOnce(value)
  render(<ResourcePolicyPanel />)
  await screen.findByText(/External coordination:/)
}

beforeEach(() => { api.mockReset(); confirm.mockReset(); confirm.mockResolvedValue(true) })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

test('loads only the admin policy and explains defaults, bounds, recovery, and next-due wakes', async () => {
  await ready(fixture({ status: { private_finance: 'must not render', usage: 999999 } }))
  expect(api).toHaveBeenCalledWith('/api/admin/resource-policy', { signal: expect.any(AbortSignal) })
  expect(client()).toHaveValue(60)
  expect(idle()).toHaveValue(180)
  expect(probe()).toHaveValue(60)
  expect(save()).toBeDisabled()
  expect(screen.getByText(/Safe defaults:/)).toHaveTextContent('180 minutes')
  expect(screen.getByText(/Bounds the recovery rescan/)).toHaveTextContent('does not reduce normal due-time precision')
  expect(screen.getByText(/do not cap all database activity/)).toBeInTheDocument()
  expect(screen.queryByText(/must not render|999999|Neon|billing/i)).not.toBeInTheDocument()
})

test('loading and unconfigured coordination disable all mutations', async () => {
  let resolve
  api.mockReturnValueOnce(new Promise(done => { resolve = done }))
  render(<ResourcePolicyPanel />)
  expect(screen.getByText('Loading resource policy...')).toBeInTheDocument()
  expect(client()).toBeDisabled()
  await act(async () => resolve(fixture({ coordination: { configured: false, healthy: false } })))
  expect(screen.getByText(/Not configured. Controls are unavailable/)).toBeInTheDocument()
  expect(idle()).toBeDisabled()
  expect(save()).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Use safe defaults' })).toBeDisabled()
  fireEvent.submit(save().closest('form'))
  expect(api).toHaveBeenCalledTimes(1)
})

test('unhealthy configured coordination is labeled honestly', async () => {
  await ready(fixture({ coordination: { configured: true, healthy: false } }))
  expect(screen.getByText(/Configured, but unhealthy/)).toBeInTheDocument()
  expect(client()).toBeEnabled()
})

test.each([
  ['client', 14], ['client', 301], ['client', 15.5], ['client', ''],
  ['idle', 14], ['idle', 1441], ['probe', 14], ['probe', 1441], ['probe', 60.5],
])('rejects invalid %s interval %s before submitting', async (field, value) => {
  await ready()
  change(({ client, idle, probe })[field](), value)
  expect(save()).toBeDisabled()
  expect(screen.getByRole('alert')).toHaveTextContent('Enter whole numbers')
  fireEvent.submit(save().closest('form'))
  expect(api).toHaveBeenCalledTimes(1)
})

test.each([15, 300])('saves client boundary %s with exact revision and public event', async value => {
  await ready()
  const next = { ...policy, client_poll_seconds: value, idle_recheck_minutes: 15, database_probe_minutes: 1440 }
  api.mockResolvedValueOnce(fixture({ policy: next, revision: 'revision-2' }))
  const listener = vi.fn()
  window.addEventListener('budgetly:resource-policy', listener)
  try {
    change(client(), value); change(idle(), 15); change(probe(), 1440)
    fireEvent.click(save())
    await screen.findByText('Resource policy saved.')
    expect(api).toHaveBeenLastCalledWith('/api/admin/resource-policy', { method: 'PUT', body: JSON.stringify({ policy: next, revision: 'revision-1' }) })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0][0].detail).toEqual({ client_poll_seconds: value })
    expect(save()).toBeDisabled()
  } finally { window.removeEventListener('budgetly:resource-policy', listener) }
})

test('increasing idle recovery asks for confirmation without claiming reduced scheduled precision', async () => {
  await ready()
  confirm.mockResolvedValueOnce(false)
  change(idle(), 240)
  fireEvent.click(save())
  await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
  expect(confirm.mock.calls[0][0]).toContain('idle interval changes recovery rescans only')
  expect(confirm.mock.calls[0][0]).toContain('scheduled tasks still use their next-due wake')
  await waitFor(() => expect(save()).toBeEnabled())
  expect(api).toHaveBeenCalledTimes(1)
  expect(idle()).toHaveValue(240)
})

test('safe defaults are an explicit unsaved draft', async () => {
  await ready(fixture({ policy: { client_poll_seconds: 30, idle_recheck_minutes: 30, database_probe_minutes: 30 } }))
  fireEvent.click(screen.getByRole('button', { name: 'Use safe defaults' }))
  expect(client()).toHaveValue(60)
  expect(idle()).toHaveValue(180)
  expect(probe()).toHaveValue(60)
  expect(screen.getByText(/Safe defaults are in the draft/)).toBeInTheDocument()
  expect(api).toHaveBeenCalledTimes(1)
})

test.each([409, 412])('conflict %s requires reload, preserves all edits, and submits the latest revision', async status => {
  await ready()
  api.mockRejectedValueOnce(Object.assign(new Error('Conflict'), { status }))
  change(client(), 30); change(idle(), 45); change(probe(), 15)
  fireEvent.click(save())
  await screen.findByRole('alert')
  expect(save()).toBeDisabled()
  api.mockRejectedValueOnce(new Error('Reload unavailable'))
  fireEvent.click(screen.getByRole('button', { name: 'Reload latest' }))
  await screen.findByText('Reload unavailable')
  expect(save()).toBeDisabled()
  api.mockResolvedValueOnce(fixture({ policy: { ...policy, client_poll_seconds: 90 }, revision: 'revision-3' }))
  fireEvent.click(screen.getByRole('button', { name: 'Reload latest' }))
  await screen.findByText(/Your draft has been preserved/)
  expect(client()).toHaveValue(30)
  expect(idle()).toHaveValue(45)
  expect(probe()).toHaveValue(15)
  api.mockResolvedValueOnce(fixture({ policy: { client_poll_seconds: 30, idle_recheck_minutes: 45, database_probe_minutes: 15 }, revision: 'revision-4' }))
  fireEvent.click(save())
  await screen.findByText('Resource policy saved.')
  expect(JSON.parse(api.mock.calls.at(-1)[1].body).revision).toBe('revision-3')
})

test('save failure keeps draft and emits no policy event', async () => {
  await ready()
  api.mockRejectedValueOnce(new Error('Admin access required'))
  const dispatch = vi.spyOn(window, 'dispatchEvent')
  change(client(), 30)
  fireEvent.click(save())
  await screen.findByText('Admin access required')
  expect(client()).toHaveValue(30)
  expect(save()).toBeEnabled()
  expect(dispatch).not.toHaveBeenCalled()
})

test('busy save disables controls and a bodyless PUT reloads its new revision', async () => {
  await ready()
  let resolve
  api.mockReturnValueOnce(new Promise(done => { resolve = done }))
  change(client(), 30)
  fireEvent.click(save())
  expect(screen.getByText('Saving resource policy...')).toBeInTheDocument()
  expect(client()).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Reload latest' })).toBeDisabled()
  api.mockResolvedValueOnce(fixture({ policy: { ...policy, client_poll_seconds: 30 }, revision: 'revision-2' }))
  await act(async () => resolve(null))
  await screen.findByText('Resource policy saved.')
  expect(api).toHaveBeenLastCalledWith('/api/admin/resource-policy')
})

test('initial load failure stays unavailable and can be retried', async () => {
  api.mockRejectedValueOnce(new Error('Unavailable'))
  render(<ResourcePolicyPanel />)
  await screen.findByText('Unavailable')
  expect(client()).toBeDisabled()
  api.mockResolvedValueOnce(fixture({ policy: { ...policy, client_poll_seconds: 90 } }))
  fireEvent.click(screen.getByRole('button', { name: 'Reload latest' }))
  await screen.findByText(/External coordination:/)
  expect(client()).toBeEnabled()
  expect(client()).toHaveValue(90)
  expect(save()).toBeDisabled()
})

test('a committed write with failed revision refresh cannot reuse the old revision', async () => {
  await ready()
  api.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('Network unavailable'))
  change(client(), 30)
  fireEvent.click(save())
  await screen.findByText('Policy saved, but its latest revision could not be loaded. Reload before saving again.')
  change(client(), 15)
  expect(save()).toBeDisabled()
  api.mockResolvedValueOnce(fixture({ policy: { ...policy, client_poll_seconds: 30 }, revision: 'revision-2' }))
  fireEvent.click(screen.getByRole('button', { name: 'Reload latest' }))
  await screen.findByText(/Your draft has been preserved/)
  expect(client()).toHaveValue(15)
  expect(save()).toBeEnabled()
})

test('malformed responses never become an editable fallback policy', async () => {
  api.mockResolvedValueOnce(fixture({ policy: { ...policy, idle_recheck_minutes: 1 } }))
  render(<ResourcePolicyPanel />)
  await screen.findByText(/response is incomplete/)
  expect(client()).toBeDisabled()
  expect(save()).toBeDisabled()
})
