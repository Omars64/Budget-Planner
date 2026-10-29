import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import FeedbackPrompt from './FeedbackPrompt'
import { api } from '../lib/api'

vi.mock('../App', () => ({ useApp: () => ({ user: { id: 7 }, notify: vi.fn() }) }))
vi.mock('../lib/api', () => ({ api: vi.fn(), jsonBody: value => ({ body: JSON.stringify(value) }) }))
vi.mock('./Modal', () => ({ default: () => null }))
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks() })

test('offline sign-out completes without waiting for optional feedback network requests', () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  api.mockImplementation(() => new Promise(() => {}))
  const complete = vi.fn()
  render(<FeedbackPrompt signoutRequested onSignoutComplete={complete}/>)
  expect(complete).toHaveBeenCalledOnce()
  // Only the initial optional prompt lookup; sign-out did not start another.
  expect(api).toHaveBeenCalledTimes(1)
})
