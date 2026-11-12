import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import App, { useApp } from './App'
import { api, auth } from './lib/api'
import { restoreOfflineSession, setOfflineUser } from './lib/offlineSync'
import { syncPlannedNotifications } from './lib/plannedNotifications'
import { notificationSettingsChangedEvent } from './lib/notificationSettings'
import { updateResourcePolicy } from './lib/resourcePolicy'
import { readDeviceAppearance } from './lib/appearance'

vi.mock('./lib/api', async importOriginal => ({
  ...await importOriginal(), api: vi.fn(), flushOfflineTransactions: vi.fn(async () => {}),
  auth: { token: 'signed-in', clear: vi.fn() },
}))
vi.mock('./lib/plannedNotifications', () => ({syncPlannedNotifications:vi.fn(),cancelPlannedNotifications:vi.fn(async()=>{})}))
vi.mock('./lib/offlineSync', () => ({rememberOfflineSession:vi.fn(async()=>{}),restoreOfflineSession:vi.fn(async()=>null),setOfflineUser:vi.fn()}))
vi.mock('./lib/useSpaces', () => ({default:()=>({spacesReady:true,activeSpace:null})}))
vi.mock('./lib/appearance', () => ({readDeviceAppearance:vi.fn(()=>({})),useAppearance:()=>{}}))
vi.mock('./components/Experience', () => ({default:()=>null}))
vi.mock('./components/FeedbackPrompt', () => ({default:()=>null}))
vi.mock('./components/AppShell', () => ({default:({children})=><main>{children}</main>}))
vi.mock('./components/RouteMotion', async () => {
  const {useLocation}=await import('react-router-dom')
  return {default:({children})=>children(useLocation())}
})
vi.mock('./pages/Overview', () => ({default:()=>{
  const {refresh,settings,setDeviceAppearance}=useApp()
  return <><button onClick={refresh}>Refresh data</button><button onClick={()=>setDeviceAppearance({color_palette:'pine'})}>{settings.theme} {settings.color_palette}</button></>
}}))

const tick = async ms => { await act(async()=>vi.advanceTimersByTimeAsync(ms)) }
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks()
  sessionStorage.clear(); localStorage.clear()
  vi.spyOn(document,'visibilityState','get').mockReturnValue('visible')
  vi.spyOn(navigator,'onLine','get').mockReturnValue(true)
  updateResourcePolicy({client_poll_seconds:60})
  syncPlannedNotifications.mockResolvedValue(undefined)
  api.mockImplementation(async path => path==='/api/auth/me' ? {id:7,role:'user'} : path==='/api/runtime-policy' ? {client_poll_seconds:60} : {})
})
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();updateResourcePolicy({client_poll_seconds:60})})

async function openApp() {
  const view=render(<MemoryRouter><App/></MemoryRouter>)
  await tick(0)
  await tick(0)
  return view
}

test('account settings cannot replace the device palette or reset the launcher on sign-in',async()=>{
  readDeviceAppearance.mockReturnValueOnce({theme:'dark',color_palette:'burgundy'})
  const setPaletteIcon=vi.fn()
  vi.stubGlobal('budgetlyDesktop',{setPaletteIcon})
  const defaultApi=api.getMockImplementation()
  api.mockImplementation((path,...args)=>path==='/api/settings' ? Promise.resolve({theme:'light',color_palette:'navy'}) : defaultApi(path,...args))
  const {container}=render(<MemoryRouter><App/></MemoryRouter>)
  expect(screen.getByRole('status',{name:'Loading Budgetly'})).toBeInTheDocument()
  expect(container.querySelector('.app-loading img')).toBeNull()
  await tick(0)
  expect(setPaletteIcon.mock.calls).toEqual([['burgundy']])
  fireEvent.click(screen.getByRole('button',{name:'dark burgundy'}))
  expect(screen.getByRole('button',{name:'dark pine'})).toBeInTheDocument()
  expect(setPaletteIcon.mock.calls).toEqual([['burgundy'],['pine']])
  expect(api.mock.calls.some(([path,options])=>path==='/api/settings'&&options?.method==='PUT')).toBe(false)
})

test('planned notification polling follows policy, pauses hidden/offline and cleans up events',async()=>{
  const view=await openApp()
  expect(syncPlannedNotifications).toHaveBeenCalledExactlyOnceWith(7)
  act(()=>window.dispatchEvent(new CustomEvent('budgetly:resource-policy',{detail:{client_poll_seconds:15}})))
  await tick(15000)
  expect(syncPlannedNotifications).toHaveBeenCalledTimes(2)
  for(let i=0;i<10;i++) window.dispatchEvent(new Event('focus'))
  await tick(0)
  expect(syncPlannedNotifications).toHaveBeenCalledTimes(2)
  vi.spyOn(document,'visibilityState','get').mockReturnValue('hidden')
  document.dispatchEvent(new Event('visibilitychange'))
  await tick(60000)
  expect(syncPlannedNotifications).toHaveBeenCalledTimes(2)
  vi.spyOn(navigator,'onLine','get').mockReturnValue(false)
  vi.spyOn(document,'visibilityState','get').mockReturnValue('visible')
  document.dispatchEvent(new Event('visibilitychange'))
  window.dispatchEvent(new Event(notificationSettingsChangedEvent))
  await tick(60000)
  expect(syncPlannedNotifications).toHaveBeenCalledTimes(2)
  vi.spyOn(navigator,'onLine','get').mockReturnValue(true)
  window.dispatchEvent(new Event('online'));window.dispatchEvent(new Event('focus'))
  await tick(0)
  expect(syncPlannedNotifications).toHaveBeenCalledTimes(3)
  view.unmount()
  window.dispatchEvent(new Event(notificationSettingsChangedEvent));window.dispatchEvent(new Event('focus'))
  await tick(60000)
  expect(syncPlannedNotifications).toHaveBeenCalledTimes(3)
})

test('explicit settings and data refreshes coalesce behind an in-flight read without overlap',async()=>{
  await openApp()
  let finish
  syncPlannedNotifications.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
  fireEvent.click(screen.getByRole('button',{name:'Refresh data'}))
  await tick(0)
  expect(syncPlannedNotifications).toHaveBeenCalledTimes(2)
  for(let i=0;i<10;i++) {
    window.dispatchEvent(new Event(notificationSettingsChangedEvent))
    fireEvent.click(screen.getByRole('button',{name:'Refresh data'}))
    window.dispatchEvent(new Event('focus'))
  }
  await tick(120000)
  expect(syncPlannedNotifications).toHaveBeenCalledTimes(2)
  await act(async()=>finish())
  await tick(0)
  expect(syncPlannedNotifications).toHaveBeenCalledTimes(3)
  await tick(59999)
  expect(syncPlannedNotifications).toHaveBeenCalledTimes(3)
  window.dispatchEvent(new Event(notificationSettingsChangedEvent))
  await tick(0)
  expect(syncPlannedNotifications).toHaveBeenCalledTimes(4)
})

test('a failed planned notification read releases the scheduler for an explicit retry',async()=>{
  const logged=vi.spyOn(console,'error').mockImplementation(()=>{})
  syncPlannedNotifications.mockRejectedValueOnce(new Error('Temporary outage'))
  await openApp()
  expect(logged).toHaveBeenCalledWith(expect.objectContaining({message:'Temporary outage'}))
  window.dispatchEvent(new Event(notificationSettingsChangedEvent))
  await tick(0)
  expect(syncPlannedNotifications).toHaveBeenCalledTimes(2)
})

test('offline reopening uses the token-bound local session without waiting for authentication I/O',async()=>{
  vi.spyOn(navigator,'onLine','get').mockReturnValue(false)
  restoreOfflineSession.mockResolvedValueOnce({user:{id:7,role:'user'},settings:{currency:'KWD'}})
  api.mockImplementation(()=>new Promise(()=>{}))
  await openApp()
  expect(restoreOfflineSession).toHaveBeenCalledWith('signed-in')
  expect(setOfflineUser).toHaveBeenCalledWith(7)
  expect(screen.getByRole('button',{name:'Refresh data'})).toBeInTheDocument()
  expect(api.mock.calls.some(([path])=>path==='/api/auth/me')).toBe(false)
  expect(auth.clear).not.toHaveBeenCalled()
})

test('offline reopening without a matching local session keeps authentication locked',async()=>{
  vi.spyOn(navigator,'onLine','get').mockReturnValue(false)
  restoreOfflineSession.mockResolvedValueOnce(null)
  await openApp()
  expect(screen.getByRole('button',{name:'Sign in',exact:true})).toBeInTheDocument()
  expect(screen.queryByRole('button',{name:'Refresh data'})).not.toBeInTheDocument()
  expect(api.mock.calls.some(([path])=>path==='/api/auth/me')).toBe(false)
})
