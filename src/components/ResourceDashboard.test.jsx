import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { api } from '../lib/api'
import ResourceDashboard from './ResourceDashboard'
vi.mock('../lib/api', () => ({ api: vi.fn() }))
beforeEach(() => api.mockReset())
afterEach(cleanup)
const refresh = kind => fireEvent.click(screen.getByRole('button', { name: `Refresh ${kind}` }))
const format = seconds => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(seconds * 1000))

test('does not fetch on mount and shows actual scheduler counts', () => {
  render(<ResourceDashboard status={{ runs: 4, skips: 9 }}/>)
  expect(api).not.toHaveBeenCalled()
  expect(screen.getByText(/Scheduler actual runs: 4/)).toHaveTextContent('Scheduler skips: 9')
})

test('explicit history refresh formats epoch seconds locally and identifies actors without names', async () => {
  const at = 1793232000
  api.mockResolvedValueOnce({ items: [
    { at, actor_id: 42, changes: { client_idle_minutes: { before: 30, after: 5 } } },
    { at: null, actor_id: 'system', changes: {} },
  ] })
  render(<ResourceDashboard />)
  refresh('history')
  await screen.findByText(`${format(at)} - Admin #42`)
  expect(screen.getByText('Unavailable - System')).toBeInTheDocument()
  expect(screen.getByText('client idle minutes: 30 to 5')).toBeInTheDocument()
  expect(api).toHaveBeenCalledExactlyOnceWith('/api/admin/resource-policy/history')
})

test('explicit metrics refresh uses flat allowlisted counters and top-level since/reset timestamps', async () => {
  const since = 1793232000
  api.mockResolvedValueOnce({ since, reset_at: since + 60, metrics: { ai_attempts: 0, ai_successes: 7, ai_output_tokens: 18, notification_failed: -1, private_data: 'secret' } })
  render(<ResourceDashboard />)
  refresh('metrics')
  await screen.findByText('AI successes')
  expect(screen.getByText('AI attempts')).toBeInTheDocument()
  expect(screen.getByText(/Tracking started:/)).toHaveTextContent(`Tracking started: ${format(since)}. Last reset: ${format(since + 60)}.`)
  expect(screen.queryByText('secret')).not.toBeInTheDocument()
  expect(screen.queryByText('Notifications failed')).not.toBeInTheDocument()
  expect(api).toHaveBeenCalledExactlyOnceWith('/api/admin/resource-metrics')
})

test('empty or unsupported metrics explicitly report unavailable with missing tracking dates', async () => {
  api.mockResolvedValueOnce({ metrics: { unknown: 1 }, since: null, reset_at: null })
  const { container } = render(<ResourceDashboard />)
  refresh('metrics')
  await screen.findByText('Metrics unavailable.')
  expect(screen.getByText(/Tracking started:/)).toHaveTextContent('Tracking started: Unavailable. Last reset: Unavailable.')
  expect(container.querySelector('dl')).toBeNull()
})

test('history and metrics errors remain independent and can be retried', async () => {
  api.mockRejectedValueOnce(new Error('History offline')).mockResolvedValueOnce({ metrics: { backup_upload_runs: 2 } }).mockResolvedValueOnce({ items: [] })
  render(<ResourceDashboard />)
  refresh('history')
  await screen.findByText('History: History offline')
  refresh('metrics')
  await screen.findByText('Backup uploads')
  expect(screen.getByText('History: History offline')).toBeInTheDocument()
  refresh('history')
  await screen.findByText('No recent changes.')
  expect(screen.queryByText('History: History offline')).not.toBeInTheDocument()
})

test.each(['history', 'metrics'])('malformed %s response reports an error', async kind => {
  api.mockResolvedValueOnce({})
  render(<ResourceDashboard />)
  refresh(kind)
  await screen.findByText(`${kind === 'history' ? 'History' : 'Metrics'}: Response is incomplete.`)
})
