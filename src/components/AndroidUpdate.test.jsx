import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import AndroidUpdate from './AndroidUpdate'
import { version } from '../../package.json'
import { hasSeenRelease, markReleaseSeen } from '../lib/releaseNotes'

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
const view = path => {
  markReleaseSeen(1, version)
  return render(<MemoryRouter initialEntries={[path || '/']}><AndroidUpdate userId={1}/></MemoryRouter>)
}
test('offers a higher code, downloads then asks Android for installation', async () => {
  view(); fireEvent.click(await screen.findByRole('button',{name:'Update now'}))
  await screen.findByText(/Allow updates from Budgetly/)
  expect(mock.download).toHaveBeenCalledWith(release)
  expect(mock.install).toHaveBeenCalledTimes(1)
  expect(mock.remove).toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button',{name:'Install update'}))
  await waitFor(()=>expect(mock.install).toHaveBeenCalledTimes(2))
})
test('download failure offers retry instead of invoking installer', async () => {
  mock.download.mockRejectedValueOnce(new Error('Checksum failed'))
  view(); fireEvent.click(await screen.findByRole('button',{name:'Update now'}))
  await screen.findByText('Checksum failed')
  expect(mock.install).not.toHaveBeenCalled()
  expect(screen.getByRole('button',{name:'Update now'})).toBeEnabled()
})
test('does not offer equal or older releases and permits a manual check in Settings', async () => {
  mock.fetch.mockResolvedValue({...release,versionCode:43}); view('/settings')
  await waitFor(()=>expect(screen.getByRole('button',{name:'Check updates'})).toBeEnabled())
  expect(screen.queryByRole('button',{name:'Update now'})).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button',{name:'Check updates'}))
  await screen.findByText('You have the latest published version.')
})
test('dismissal hides the notice without changing app records', async () => {
  view(); fireEvent.click(await screen.findByRole('button',{name:'Close dialog'}))
  await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})
test('checks browser releases without invoking native updater', async () => {
  mock.enabled=false; mock.fetch.mockResolvedValue({version:'99.0.0'}); view('/settings')
  await screen.findByRole('button',{name:'Refresh to latest version'})
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(mock.info).not.toHaveBeenCalled()
  expect(mock.download).not.toHaveBeenCalled()
})
test('disabled alerts hide the automatic notice but retain manual Settings updates', async () => {
  localStorage.setItem('budgetly-update-notifications-v1','false'); view()
  await waitFor(()=>expect(mock.fetch).toHaveBeenCalled())
  expect(screen.queryByRole('button',{name:'Update now'})).not.toBeInTheDocument()
  cleanup(); view('/settings')
  fireEvent.click(await screen.findByRole('button',{name:'View update'}))
  await screen.findByRole('button',{name:'Update now'})
})

test('authentication never checks or displays updates even when a newer release exists', async () => {
  render(<MemoryRouter initialEntries={['/settings']}><AndroidUpdate authentication/></MemoryRouter>)
  expect(mock.fetch).not.toHaveBeenCalled()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.queryByRole('region',{name:'App updates'})).not.toBeInTheDocument()
  expect(screen.queryByRole('button',{name:'Check updates'})).not.toBeInTheDocument()
})

test('checks for new updates on signed-in resume without requiring logout', async () => {
  mock.fetch.mockResolvedValueOnce({...release,versionCode:43})
  view()
  await waitFor(() => expect(mock.fetch).toHaveBeenCalledTimes(1))
  const now = Date.now()
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 300001)
  window.dispatchEvent(new Event('focus'))
  await screen.findByRole('button', {name:'Update now'})
  expect(mock.fetch).toHaveBeenCalledTimes(2)
  clock.mockRestore()
})

test('browser shows installed release notes after sign-in, once acknowledged', async () => {
  mock.enabled=false;mock.fetch.mockResolvedValue({version})
  const signedIn=()=>render(<MemoryRouter><AndroidUpdate userId={77}/></MemoryRouter>)
  signedIn()
  await screen.findByRole('heading',{name:"What's new"},{timeout:2500})
  fireEvent.click(screen.getByRole('button',{name:'Continue to Budgetly'}))
  expect(hasSeenRelease(77,version)).toBe(true)
  cleanup();signedIn()
  await new Promise(resolve=>setTimeout(resolve,1000))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(mock.download).not.toHaveBeenCalled()
})
test('guest screens do not display post-update release notes', async () => {
  mock.enabled=false;mock.fetch.mockResolvedValue({version})
  render(<MemoryRouter><AndroidUpdate userId={77} guest/></MemoryRouter>)
  await new Promise(resolve=>setTimeout(resolve,1000))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
test('Android displays published release notes in the download popup', async () => {
  mock.fetch.mockResolvedValue({...release,notes:[{title:'Verified change',detail:'Details for this version'}]})
  view()
  await screen.findByText('Verified change')
  expect(screen.getByText('Details for this version')).toBeInTheDocument()
})

test('installed notes take priority over the next Android update and are acknowledged once', async () => {
  render(<MemoryRouter><AndroidUpdate userId={88}/></MemoryRouter>)
  await screen.findByRole('heading', {name:"What's new"}, {timeout:2500})
  expect(screen.queryByRole('button', {name:'Update now'})).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', {name:'Continue to Budgetly'}))
  await screen.findByRole('button', {name:'Update now'})
  expect(hasSeenRelease(88, version)).toBe(true)
})

test('native guest mode never checks or offers an account update prompt', () => {
  render(<MemoryRouter initialEntries={['/settings']}><AndroidUpdate userId={77} guest/></MemoryRouter>)
  expect(mock.fetch).not.toHaveBeenCalled()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.queryByRole('region', {name:'App updates'})).not.toBeInTheDocument()
})
