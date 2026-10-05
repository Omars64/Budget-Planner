import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import AndroidUpdate from './AndroidUpdate'

const mock = vi.hoisted(() => ({ enabled:true, info:vi.fn(), fetch:vi.fn(), download:vi.fn(), install:vi.fn(), listener:vi.fn(), remove:vi.fn() }))
vi.mock('../lib/appUpdates', () => ({ androidUpdatesAvailable:()=>mock.enabled, fetchRelease:mock.fetch,
  fetchWebRelease:mock.fetch, newerVersion:value=>value==='99.0.0',
  AppUpdater:{info:mock.info,download:mock.download,install:mock.install,addListener:mock.listener} }))
vi.mock('../lib/updateNotifications',()=>({notifyAppUpdate:vi.fn().mockResolvedValue(),cancelUpdateNotification:vi.fn().mockResolvedValue()}))
vi.mock('../lib/updatePush',()=>({syncUpdatePush:vi.fn().mockResolvedValue({})}))
const release = {version:'5.9.0',versionCode:44,url:'https://github.com/Omars64/Budget-Planner/releases/download/v5.9.0/Budgetly.apk'}
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); mock.enabled=true
  mock.info.mockResolvedValue({versionCode:43}); mock.fetch.mockResolvedValue(release)
  mock.download.mockResolvedValue({}); mock.install.mockResolvedValue({permissionRequired:true})
  mock.remove.mockResolvedValue(); mock.listener.mockResolvedValue({remove:mock.remove})
})
afterEach(cleanup)
const view = path => render(<MemoryRouter initialEntries={[path || '/']}><AndroidUpdate/></MemoryRouter>)
test('offers a higher code, downloads then asks Android for installation', async () => {
  view(); fireEvent.click(await screen.findByRole('button',{name:'Update'}))
  await screen.findByText(/Allow updates from Budgetly/)
  expect(mock.download).toHaveBeenCalledWith(release)
  expect(mock.install).toHaveBeenCalledTimes(1)
  expect(mock.remove).toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button',{name:'Install'}))
  await waitFor(()=>expect(mock.install).toHaveBeenCalledTimes(2))
})
test('download failure offers retry instead of invoking installer', async () => {
  mock.download.mockRejectedValueOnce(new Error('Checksum failed'))
  view(); fireEvent.click(await screen.findByRole('button',{name:'Update'}))
  await screen.findByText('Checksum failed')
  expect(mock.install).not.toHaveBeenCalled()
  expect(screen.getByRole('button',{name:'Update'})).toBeEnabled()
})
test('does not offer equal or older releases and permits a manual check in Settings', async () => {
  mock.fetch.mockResolvedValue({...release,versionCode:43}); view('/settings')
  await waitFor(()=>expect(screen.getByRole('button',{name:'Check updates'})).toBeEnabled())
  expect(screen.queryByRole('button',{name:'Update'})).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button',{name:'Check updates'}))
  await screen.findByText('You have the latest published version.')
})
test('dismissal hides the notice without changing app records', async () => {
  view(); fireEvent.click(await screen.findByRole('button',{name:'Remind me later'}))
  expect(screen.queryByRole('region',{name:'App updates'})).not.toBeInTheDocument()
})
test('checks browser releases without invoking native updater', async () => {
  mock.enabled=false; mock.fetch.mockResolvedValue({version:'99.0.0'}); view('/settings')
  await screen.findByText('Budgetly 99.0.0 is available')
  expect(mock.info).not.toHaveBeenCalled()
  expect(mock.download).not.toHaveBeenCalled()
})
test('disabled alerts hide the automatic notice but retain manual Settings updates', async () => {
  localStorage.setItem('budgetly-update-notifications-v1','false'); view()
  await waitFor(()=>expect(mock.fetch).toHaveBeenCalled())
  expect(screen.queryByRole('button',{name:'Update'})).not.toBeInTheDocument()
  cleanup(); view('/settings')
  await screen.findByRole('button',{name:'Update'})
})
