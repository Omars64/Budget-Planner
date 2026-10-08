import { afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ plugin: { getPendingNotifications: vi.fn(), removeNotifications: vi.fn(), suspend: vi.fn() }, api: vi.fn(), auth: { token: 'signed-in' } }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' }, registerPlugin: () => mocks.plugin }))
vi.mock('../api', () => ({ api: mocks.api, auth: mocks.auth, jsonBody: data => ({ body: JSON.stringify(data) }) }))
import { syncBankNotifications } from './native'
afterEach(() => vi.clearAllMocks())
it('uploads structured fields only and acknowledges after acceptance', async () => {
  mocks.plugin.getPendingNotifications.mockResolvedValue({ notifications: [{ id: 'one', packageName: 'test.bank', appLabel: 'Bank', contentHash: 'a'.repeat(64), postedAt: Date.now(), text: 'Purchase KWD 5.000 at Shop' }] })
  mocks.api.mockResolvedValue({ id: 1 })
  await syncBankNotifications(1)
  const payload = JSON.parse(mocks.api.mock.calls[0][1].body)
  expect(payload).toMatchObject({ merchant: 'Shop', amount: '5.000' })
  expect(payload).not.toHaveProperty('text')
  expect(mocks.plugin.removeNotifications).toHaveBeenCalledWith({ owner: '1', ids: ['one'] })
  expect(mocks.api.mock.invocationCallOrder[0]).toBeLessThan(mocks.plugin.removeNotifications.mock.invocationCallOrder[0])
})
it('retains the queue when upload fails', async () => {
  mocks.plugin.getPendingNotifications.mockResolvedValue({ notifications: [{ id: 'two', packageName: 'test.bank', contentHash: 'b'.repeat(64), text: 'Purchase KWD 5.000', postedAt: Date.now() }] })
  mocks.api.mockRejectedValue(new Error('Offline'))
  await expect(syncBankNotifications(1)).rejects.toThrow('Offline')
  expect(mocks.plugin.removeNotifications).not.toHaveBeenCalled()
})
it('drops OTP locally without uploading it', async () => {
  mocks.plugin.getPendingNotifications.mockResolvedValue({ notifications: [{ id: 'otp', text: 'OTP 12345' }] })
  await syncBankNotifications(1)
  expect(mocks.api).not.toHaveBeenCalled()
  expect(mocks.plugin.removeNotifications).toHaveBeenCalled()
})
