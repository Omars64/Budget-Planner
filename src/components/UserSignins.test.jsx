import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { api } from '../lib/api'
import UserSignins from './UserSignins'
vi.mock('../lib/api', () => ({api:vi.fn()}))
afterEach(() => {cleanup(); vi.resetAllMocks()})
const account = {id:42,username:'Synthetic'}
test('loads bounded history, distinguishes activity, and paginates', async () => {
  api.mockResolvedValueOnce({items:[{device:'Android · Chrome',status:'Ended',signed_in_at:'2026-10-24T09:00:00Z',last_active_at:'2026-10-24T10:00:00Z'}],has_more:true})
    .mockResolvedValueOnce({items:[],has_more:false})
  render(<UserSignins account={account} onClose={vi.fn()}/>)
  await screen.findByText('Android · Chrome')
  expect(screen.getByText('Signed in')).toBeInTheDocument()
  expect(screen.getByText('Last active')).toBeInTheDocument()
  expect(screen.getByRole('button',{name:'Previous'})).toBeDisabled()
  fireEvent.click(screen.getByRole('button',{name:'Next'}))
  await screen.findByText('No recorded sign-ins on this page.')
  expect(api).toHaveBeenLastCalledWith('/api/admin/users/42/signins?offset=50',expect.objectContaining({signal:expect.any(AbortSignal)}))
})
test('failed requests offer retry without stale results', async () => {
  api.mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValueOnce({items:[],has_more:false})
  render(<UserSignins account={account} onClose={vi.fn()}/>)
  await screen.findByRole('alert')
  fireEvent.click(screen.getByRole('button',{name:'Retry'}))
  await screen.findByText('No recorded sign-ins on this page.')
})
