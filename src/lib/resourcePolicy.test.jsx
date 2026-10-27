import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { api } from './api'
import { readResourcePolicy, updateResourcePolicy, useResourcePolicy, startReadPolling, startResourcePolicySession } from './resourcePolicy'
import { CLIENT_IDLE_MS } from './clientActivity'

vi.mock('./api', () => ({ api: vi.fn() }))
let stops
const tick = async ms => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
const visible = value => { Object.defineProperty(document, 'visibilityState', { configurable: true, value }); document.dispatchEvent(new Event('visibilitychange')) }
const online = value => { Object.defineProperty(navigator, 'onLine', { configurable: true, value }); window.dispatchEvent(new Event(value ? 'online' : 'offline')) }
beforeEach(() => {
  vi.useFakeTimers()
  stops = []
  visible('visible'); online(true)
  updateResourcePolicy({ client_poll_seconds: 60 })
  api.mockReset()
})
afterEach(() => {
  stops.forEach(stop => stop()); cleanup()
  vi.useRealTimers(); vi.restoreAllMocks()
  visible('visible'); online(true)
})

test('defaults to 60 seconds and rejects invalid policy values', () => {
  for (const client_poll_seconds of [null, '15', 14, 301, 15.5]) updateResourcePolicy({ client_poll_seconds })
  expect(readResourcePolicy()).toEqual({ client_poll_seconds: 60 })
})

test('pauses hidden/offline reads and coalesces focus, visibility and online storms', async () => {
  const read = vi.fn(async () => {})
  stops.push(startReadPolling(read))
  await tick(0)
  expect(read).toHaveBeenCalledTimes(1)
  visible('hidden'); await tick(120000)
  expect(read).toHaveBeenCalledTimes(1)
  online(false); visible('visible'); await tick(120000)
  expect(read).toHaveBeenCalledTimes(1)
  online(true)
  for (let i = 0; i < 10; i++) window.dispatchEvent(new Event('focus'))
  await tick(0)
  expect(read).toHaveBeenCalledTimes(2)
  for (let i = 0; i < 10; i++) { online(true); visible('visible'); window.dispatchEvent(new Event('focus')) }
  await tick(59999)
  expect(read).toHaveBeenCalledTimes(2)
  await tick(1)
  expect(read).toHaveBeenCalledTimes(3)
})

test('never overlaps slow reads, including policy and lifecycle changes', async () => {
  let finish
  const read = vi.fn(() => new Promise(resolve => { finish = resolve }))
  stops.push(startReadPolling(read))
  await tick(0)
  updateResourcePolicy({ client_poll_seconds: 15 })
  await tick(300000)
  window.dispatchEvent(new Event('focus')); online(true)
  await tick(0)
  expect(read).toHaveBeenCalledTimes(1)
  await act(async () => finish())
  await tick(14999)
  expect(read).toHaveBeenCalledTimes(1)
  await tick(1)
  expect(read).toHaveBeenCalledTimes(2)
})

test('event and helper settings propagate to mounted hooks and schedulers without an immediate read', async () => {
  const hook = renderHook(useResourcePolicy)
  const a = vi.fn(async () => {}), b = vi.fn(async () => {})
  stops.push(startReadPolling(a), startReadPolling(b))
  await tick(0)
  act(() => window.dispatchEvent(new CustomEvent('budgetly:resource-policy', { detail: { client_poll_seconds: 15 } })))
  expect(hook.result.current.client_poll_seconds).toBe(15)
  await tick(14999)
  expect(a).toHaveBeenCalledTimes(1)
  await tick(1)
  expect(a).toHaveBeenCalledTimes(2); expect(b).toHaveBeenCalledTimes(2)
  act(() => updateResourcePolicy({ client_poll_seconds: 300 }))
  await tick(60000)
  expect(a).toHaveBeenCalledTimes(2)
})

test('cleans timers and every event listener on stop and hook unmount', async () => {
  const removedWindow = vi.spyOn(window, 'removeEventListener')
  const removedDocument = vi.spyOn(document, 'removeEventListener')
  const hook = renderHook(useResourcePolicy)
  const read = vi.fn(async () => {})
  const stop = startReadPolling(read)
  await tick(0); stop(); hook.unmount()
  for (const event of ['focus', 'online', 'offline', 'budgetly:resource-policy']) expect(removedWindow).toHaveBeenCalledWith(event, expect.any(Function))
  expect(removedDocument).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
  expect(vi.getTimerCount()).toBe(0)
  window.dispatchEvent(new Event('focus')); online(true); visible('visible')
  await tick(300000)
  expect(read).toHaveBeenCalledTimes(1)
})

test('loads policy only when visible and online, bounds refresh to 15 minutes and ignores stale session results', async () => {
  visible('hidden')
  api.mockResolvedValue({ client_poll_seconds: 30 })
  const stop = startResourcePolicySession(); stops.push(stop)
  await tick(60000)
  expect(api).not.toHaveBeenCalled()
  visible('visible'); await tick(0)
  expect(api).toHaveBeenCalledExactlyOnceWith('/api/runtime-policy')
  for (let i = 0; i < 10; i++) window.dispatchEvent(new Event('focus'))
  await tick(899999)
  expect(api).toHaveBeenCalledTimes(1)
  await tick(1)
  expect(api).toHaveBeenCalledTimes(2)
  stop()
  let finish
  api.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const stopNext = startResourcePolicySession(); stops.push(stopNext)
  await tick(0); stopNext()
  await act(async () => finish({ client_poll_seconds: 300 }))
  expect(readResourcePolicy().client_poll_seconds).toBe(30)
})

test('a policy fetch cannot overwrite a newer admin update and failures retain the last policy', async () => {
  let finish
  api.mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockRejectedValue(new Error('Offline'))
  stops.push(startResourcePolicySession())
  await tick(0)
  updateResourcePolicy({ client_poll_seconds: 15 })
  await act(async () => finish({ client_poll_seconds: 60 }))
  expect(readResourcePolicy().client_poll_seconds).toBe(15)
  await tick(900000)
  expect(readResourcePolicy().client_poll_seconds).toBe(15)
})

test('active generation uses its bounded cadence independently of the idle policy', async () => {
  const read = vi.fn(async () => {})
  stops.push(startReadPolling(read, { immediate: false, intervalMs: 3000 }))
  updateResourcePolicy({ client_poll_seconds: 300 })
  await tick(2999); expect(read).not.toHaveBeenCalled()
  await tick(1); expect(read).toHaveBeenCalledTimes(1)
  online(false); await tick(30000); expect(read).toHaveBeenCalledTimes(1)
})

test('an offline explicit refresh stays immediate after a policy change and cannot revive a stopped poller', async () => {
  const read = vi.fn(async () => {})
  const stop = startReadPolling(read)
  stops.push(stop)
  await tick(0)
  online(false)
  stop.refresh()
  updateResourcePolicy({client_poll_seconds:300})
  await tick(1000)
  expect(read).toHaveBeenCalledTimes(1)
  online(true)
  await tick(0)
  expect(read).toHaveBeenCalledTimes(2)
  stop(); stop.refresh()
  await tick(300000)
  expect(read).toHaveBeenCalledTimes(2)
})

test('an in-flight explicit refresh stays queued through offline completion and a policy change', async () => {
  let finish
  const read = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValue(undefined)
  const stop = startReadPolling(read)
  stops.push(stop)
  await tick(0)
  stop.refresh(); stop.refresh()
  online(false)
  await act(async () => finish())
  updateResourcePolicy({client_poll_seconds:300})
  await tick(1000)
  expect(read).toHaveBeenCalledTimes(1)
  online(true)
  window.dispatchEvent(new Event('focus'))
  await tick(0)
  expect(read).toHaveBeenCalledTimes(2)
  await tick(299999)
  expect(read).toHaveBeenCalledTimes(2)
})

test('visible but untouched clients stop after 30 minutes and interaction resumes each reader once', async () => {
  const a = vi.fn(async () => {}), b = vi.fn(async () => {})
  stops.push(startReadPolling(a), startReadPolling(b))
  await tick(CLIENT_IDLE_MS)
  expect(a).toHaveBeenCalledTimes(30)
  expect(b).toHaveBeenCalledTimes(30)
  await tick(CLIENT_IDLE_MS * 3)
  expect(a).toHaveBeenCalledTimes(30)
  for (let i=0;i<20;i++) document.dispatchEvent(new Event('pointermove'))
  await tick(0)
  expect(a).toHaveBeenCalledTimes(31)
  expect(b).toHaveBeenCalledTimes(31)
  await tick(59999)
  expect(a).toHaveBeenCalledTimes(31)
})

test('typing renews inactivity, while policy changes and reconnect alone do not wake idle clients', async () => {
  const read = vi.fn(async () => {})
  stops.push(startReadPolling(read))
  await tick(CLIENT_IDLE_MS - 1000)
  document.dispatchEvent(new Event('keydown'))
  await tick(CLIENT_IDLE_MS - 1000)
  const before = read.mock.calls.length
  await tick(60000)
  expect(read.mock.calls.length).toBe(before)
  updateResourcePolicy({client_poll_seconds:15})
  online(false); online(true)
  await tick(60000)
  expect(read.mock.calls.length).toBe(before)
  visible('hidden'); visible('visible')
  await tick(0)
  expect(read.mock.calls.length).toBe(before+1)
})

test('manual refresh wakes an idle client but a stopped reader cannot wake anything', async () => {
  const read = vi.fn(async () => {})
  const stop = startReadPolling(read); stops.push(stop)
  await tick(CLIENT_IDLE_MS + 1000)
  const before = read.mock.calls.length
  stop.refresh()
  await tick(0)
  expect(read.mock.calls.length).toBe(before+1)
  stop()
  stop.refresh()
  document.dispatchEvent(new Event('pointerdown'))
  await tick(CLIENT_IDLE_MS)
  expect(read.mock.calls.length).toBe(before+1)
  expect(vi.getTimerCount()).toBe(0)
})

test('a read already in flight finishes normally when the client becomes idle', async () => {
  let finish
  const read = vi.fn().mockImplementationOnce(() => new Promise(resolve=>{finish=resolve})).mockResolvedValue(undefined)
  stops.push(startReadPolling(read))
  await tick(CLIENT_IDLE_MS)
  await act(async()=>finish())
  await tick(60000)
  expect(read).toHaveBeenCalledTimes(1)
  document.dispatchEvent(new Event('touchstart'))
  await tick(0)
  expect(read).toHaveBeenCalledTimes(2)
})
