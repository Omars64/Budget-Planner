import { beforeEach, expect, it, vi } from 'vitest'
import { api, auth } from './api'
import { installClientDiagnostics, reportClientFailure } from './diagnostics'
vi.mock('./api', () => ({ api: vi.fn(() => Promise.resolve()), auth: {token:''}, jsonBody: value => ({body:JSON.stringify(value)}) }))
beforeEach(() => { vi.clearAllMocks(); auth.token = ''; window.location.hash = '#/transactions?private=secret' })
it('sends only allowlisted metadata and throttles error storms', () => {
  reportClientFailure('render'); expect(api).not.toHaveBeenCalled()
  auth.token = 'secret'
  reportClientFailure('render'); reportClientFailure('render')
  expect(api).toHaveBeenCalledTimes(1)
  const payload = JSON.parse(api.mock.calls[0][1].body)
  expect(payload.page).toBe('/transactions')
  expect(Object.keys(payload).sort()).toEqual(['code','page','version'])
  expect(JSON.stringify(payload)).not.toContain('secret')
})
it('removes global listeners when disposed', () => {
  auth.token = 'secret'
  const dispose = installClientDiagnostics()
  dispose()
  window.dispatchEvent(new Event('unhandledrejection'))
  expect(api).not.toHaveBeenCalled()
})
