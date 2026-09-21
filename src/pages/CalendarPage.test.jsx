import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import CalendarPage from './CalendarPage'
import { api } from '../lib/api'

vi.mock('../App', () => ({ useApp: () => ({ settings: { currency: 'KWD' }, refreshKey: 0 }) }))
vi.mock('../lib/api', () => ({ api: vi.fn(), money: value => `KWD ${Number(value).toFixed(3)}` }))

beforeEach(() => { vi.clearAllMocks(); api.mockResolvedValue({}) })
afterEach(cleanup)

it('loads personal day details and distinguishes a failed request from an empty day', async () => {
  api.mockImplementation(path => path.startsWith('/api/calendar') ? Promise.resolve({}) : Promise.reject(new Error('Connection unavailable')))
  render(<CalendarPage />)
  fireEvent.click(screen.getByRole('button', { name: '15', exact: true }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Connection unavailable')
  expect(screen.queryByText('No transactions recorded on this date.')).not.toBeInTheDocument()
  expect(api.mock.calls.find(([path]) => path.startsWith('/api/transactions'))[0]).toContain('scope=personal')
  api.mockResolvedValue([])
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(await screen.findByText('No transactions recorded on this date.')).toBeInTheDocument()
})

it('aborts an old day request when the month changes', async () => {
  let daySignal
  api.mockImplementation((path, options) => {
    if (path.startsWith('/api/calendar')) return Promise.resolve({})
    daySignal = options.signal
    return new Promise(() => {})
  })
  render(<CalendarPage />)
  fireEvent.click(screen.getByRole('button', { name: '15', exact: true }))
  expect(await screen.findByRole('status')).toHaveTextContent('Loading transactions')
  fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
  await waitFor(() => expect(daySignal.aborted).toBe(true))
  expect(screen.getByText('Choose a date')).toBeInTheDocument()
})
