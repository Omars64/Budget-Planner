import { act, cleanup, render } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import Feedback from './Feedback'
import { api } from '../lib/api'
import { updateResourcePolicy } from '../lib/resourcePolicy'

vi.mock('../App', () => ({useApp:()=>({user:{id:1,role:'user'},notify:vi.fn(),confirm:vi.fn()})}))
vi.mock('../lib/api', () => ({api:vi.fn(),jsonBody:value=>({body:JSON.stringify(value)})}))
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); updateResourcePolicy({client_poll_seconds:60}) })

test('feedback follows policy updates, pauses hidden/offline, and cleans up on unmount', async () => {
  vi.useFakeTimers()
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  const connectivity = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  api.mockResolvedValue([])
  const view = render(<Feedback/> )
  await act(async () => vi.advanceTimersByTimeAsync(0))
  expect(api).toHaveBeenCalledTimes(1)
  visibility.mockReturnValue('hidden')
  document.dispatchEvent(new Event('visibilitychange'))
  await act(async () => vi.advanceTimersByTimeAsync(120000))
  expect(api).toHaveBeenCalledTimes(1)
  connectivity.mockReturnValue(false); visibility.mockReturnValue('visible')
  document.dispatchEvent(new Event('visibilitychange'))
  await act(async () => vi.advanceTimersByTimeAsync(60000))
  expect(api).toHaveBeenCalledTimes(1)
  connectivity.mockReturnValue(true)
  window.dispatchEvent(new Event('online')); window.dispatchEvent(new Event('focus'))
  await act(async () => vi.advanceTimersByTimeAsync(0))
  expect(api).toHaveBeenCalledTimes(2)
  act(() => window.dispatchEvent(new CustomEvent('budgetly:resource-policy',{detail:{client_poll_seconds:15}})))
  await act(async () => vi.advanceTimersByTimeAsync(15000))
  expect(api).toHaveBeenCalledTimes(3)
  view.unmount()
  window.dispatchEvent(new Event('focus'))
  await act(async () => vi.advanceTimersByTimeAsync(60000))
  expect(api).toHaveBeenCalledTimes(3)
})
