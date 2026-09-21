import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import GoalsDebts from './GoalsDebts'
import { api } from '../lib/api'

vi.mock('../App', () => ({ useApp: () => ({ settings: { currency: 'KWD' }, refreshKey: 0, refresh: vi.fn(), notify: vi.fn(), confirm: vi.fn() }) }))
vi.mock('../lib/api', () => ({ api: vi.fn(), money: value => String(value), jsonBody: value => ({ body: JSON.stringify(value) }) }))
afterEach(cleanup)

it('preserves a fully paid debt when editing its original amount', async () => {
  api.mockImplementation(path => Promise.resolve(path === '/api/debts' ? [{ id: 17, name: 'Paid loan', kind: 'owed', principal: 100, remaining: 0, progress: 100 }] : []))
  render(<GoalsDebts />)
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Paid loan' }))
  expect(screen.getByLabelText('Remaining')).toHaveValue(0)
  fireEvent.change(screen.getByLabelText('Original amount'), { target: { value: '150' } })
  expect(screen.getByLabelText('Remaining')).toHaveValue(0)
  fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }))
  await waitFor(() => expect(api).toHaveBeenCalledWith('/api/debts/17', expect.objectContaining({ method: 'PUT' })))
  const [, options] = api.mock.calls.find(([path]) => path === '/api/debts/17')
  expect(JSON.parse(options.body)).toMatchObject({ principal: 150, remaining: 0 })
})
