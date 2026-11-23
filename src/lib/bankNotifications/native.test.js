import { afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ plugin: { addListener: vi.fn(), bindSession: vi.fn(), getPendingNotifications: vi.fn(), removeNotifications: vi.fn(), suspend: vi.fn() }, api: vi.fn(), auth: { token: 'signed-in' } }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' }, registerPlugin: () => mocks.plugin }))
vi.mock('../api', () => ({ api: mocks.api, auth: mocks.auth, jsonBody: data => ({ body: JSON.stringify(data) }) }))
import { bankInboxChanged, syncBankNotifications, watchBankNotifications } from './native'
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

it('drains a notification posted while an earlier bank alert is uploading', async () => {
  const raw = id => ({ id, packageName: 'test.bank', postedAt: Date.now(), text: 'Purchase KWD 5.000 at Shop' })
  mocks.plugin.getPendingNotifications.mockResolvedValueOnce({ notifications: [raw('first')] })
    .mockResolvedValueOnce({ notifications: [raw('second')] })
  let finishUpload
  let started
  const uploading = new Promise(resolve => { started = resolve })
  mocks.api.mockResolvedValue({ id: 2 }).mockImplementationOnce(() => {
    started()
    return new Promise(resolve => { finishUpload = resolve })
  })
  const refreshed = vi.fn()
  window.addEventListener(bankInboxChanged, refreshed)
  try {
    const sync = syncBankNotifications(1)
    await uploading
    expect(syncBankNotifications(1)).toBe(sync)
    finishUpload({ id: 1 })
    await sync
    expect(mocks.api).toHaveBeenCalledTimes(2)
    expect(mocks.plugin.removeNotifications).toHaveBeenLastCalledWith({ owner: '1', ids: ['second'] })
    expect(refreshed).toHaveBeenCalledOnce()
  } finally {
    window.removeEventListener(bankInboxChanged, refreshed)
  }
})

it('uploads on the foreground native signal and removes the subscription at sign-out', async () => {
  const remove = vi.fn(async () => {})
  let queued
  mocks.plugin.addListener.mockImplementation(async (event, listener) => {
    expect(event).toBe('notificationQueued')
    queued = listener
    return { remove }
  })
  mocks.plugin.bindSession.mockResolvedValue(undefined)
  mocks.plugin.getPendingNotifications.mockResolvedValueOnce({ notifications: [] })
    .mockResolvedValueOnce({ notifications: [{ id: 'arrival', packageName: 'test.bank', postedAt: Date.now(), text: 'Purchase KWD 5.000 at Shop' }] })
  mocks.api.mockResolvedValue({ id: 3 })
  const stop = watchBankNotifications(1)
  try {
    await vi.waitFor(() => expect(mocks.plugin.getPendingNotifications).toHaveBeenCalledOnce())
    await queued()
    expect(mocks.api).toHaveBeenCalledOnce()
    expect(mocks.plugin.removeNotifications).toHaveBeenCalledWith({ owner: '1', ids: ['arrival'] })
  } finally {
    stop()
  }
  expect(remove).toHaveBeenCalledOnce()
  await queued()
  expect(mocks.api).toHaveBeenCalledOnce()
})
