import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { setUpcomingPushActive } from './upcomingDelivery'
import { LocalNotifications } from '@capacitor/local-notifications'
import { api } from './api'
import { readNotificationSettings } from './notificationSettings'
import { cancelPlannedNotifications, reminderAt, syncPlannedNotifications } from './plannedNotifications'

vi.mock('@capacitor/local-notifications',()=>({LocalNotifications:{getPending:vi.fn(),cancel:vi.fn(),schedule:vi.fn(),checkPermissions:vi.fn()}}))
vi.mock('./api',()=>({api:vi.fn()}))
const platform = vi.hoisted(()=>({native:true}))
vi.mock('./deviceNotifications',()=>({isNativeApp:()=>platform.native}))
vi.mock('./notificationSettings',()=>({readNotificationSettings:vi.fn()}))

beforeEach(async()=>{
  platform.native=true
  localStorage.clear();sessionStorage.clear()
  vi.clearAllMocks()
  LocalNotifications.getPending.mockResolvedValue({notifications:[]})
  LocalNotifications.checkPermissions.mockResolvedValue({display:'granted'})
  await cancelPlannedNotifications()
  readNotificationSettings.mockReturnValue({upcoming_reminders_enabled:true,upcoming_reminder_days:0,upcoming_reminder_time:'09:00'})
})
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals()})

it('uses open-browser fallback once and never duplicates registered closed-browser reminders', async () => {
  platform.native=false
  const now = new Date('2026-10-21T10:00:00+03:00').getTime()
  vi.spyOn(Date,'now').mockReturnValue(now)
  const show = vi.fn()
  class Notification { static permission='granted'; constructor(title,options) {show(title,options)} }
  vi.stubGlobal('Notification',Notification)
  readNotificationSettings.mockReturnValue({upcoming_reminders_enabled:true,upcoming_reminder_mode:'before',upcoming_reminder_minutes:90})
  api.mockImplementation(path=>Promise.resolve(path.startsWith('/api/planned-transactions') ? [{id:12,date:'2026-10-21T11:00:00+03:00',description:'Rent',status:'planned',type:'expense',reminder_enabled:true}] : {items:[]}))
  setUpcomingPushActive(9,true)
  await syncPlannedNotifications(9)
  expect(show).not.toHaveBeenCalled()
  setUpcomingPushActive(9,false)
  await syncPlannedNotifications(9)
  await syncPlannedNotifications(9)
  expect(show).toHaveBeenCalledOnce()
  expect(show.mock.calls[0][0]).toBe('Upcoming: Rent')
})

it('uses Kuwait calendar days and the chosen time before an expense', () => {
  const row = {date:'2026-09-30T10:00:00+03:00'}
  expect(reminderAt(row,{upcoming_reminder_days:1,upcoming_reminder_time:'09:00'}).toISOString()).toBe('2026-09-29T06:00:00.000Z')
})

it('never puts a same-day reminder after the expense', () => {
  const row = {date:'2026-09-30T10:00:00+03:00'}
  expect(reminderAt(row,{upcoming_reminder_days:0,upcoming_reminder_time:'18:00'}).toISOString()).toBe('2026-09-30T06:55:00.000Z')
})

it('combines Bills and Upcoming with stable native IDs and the earliest reminders first',async()=>{
  const tomorrow=new Date(Date.now()+2*86400000).toISOString().slice(0,10)
  const later=new Date(Date.now()+3*86400000).toISOString().slice(0,10)
  api.mockImplementation(path=>Promise.resolve(path.startsWith('/api/planned-transactions') ? [{id:12,date:`${later}T12:00:00+03:00`,description:'Rent',wallet_name:'Main',status:'scheduled',type:'expense',reminder_enabled:true}] : {items:[{id:'bill:example:cycle',notification_id:400123456,date:`${tomorrow}T12:00:00+03:00`,description:'Subscription',wallet_name:'Main',status:'planned',type:'expense',reminder_enabled:true}]}))
  await syncPlannedNotifications(1)
  const notifications=LocalNotifications.schedule.mock.calls[0][0].notifications
  expect(notifications.map(row=>row.id)).toEqual([400123456,200012])
  expect(notifications[0].title).toContain('Subscription')
  expect(notifications[0].body).toContain('Due')
})

it('cancels Bills and Upcoming when their shared reminder preference is off',async()=>{
  readNotificationSettings.mockReturnValue({upcoming_reminders_enabled:false})
  LocalNotifications.getPending.mockResolvedValue({notifications:[{id:400123456},{id:200012},{id:100}]})
  api.mockResolvedValueOnce([]).mockResolvedValueOnce({items:[]})
  await syncPlannedNotifications(2)
  expect(LocalNotifications.cancel).toHaveBeenLastCalledWith({notifications:[{id:400123456},{id:200012}]})
  expect(LocalNotifications.schedule).not.toHaveBeenCalled()
})

it('keeps existing Upcoming reminders when the Planner reminder endpoint is unavailable',async()=>{
  api.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('offline'))
  await expect(syncPlannedNotifications(3)).resolves.toBeUndefined()
  expect(LocalNotifications.schedule).not.toHaveBeenCalled()
})

it('supports an exact lead duration across midnight and month boundaries', () => {
  expect(reminderAt({date:'2027-01-01T00:15:00+03:00'}, {upcoming_reminder_mode:'before', upcoming_reminder_minutes:90}).toISOString()).toBe('2026-12-31T19:45:00.000Z')
})

it('does not cancel existing bill alarms during a Planner outage', async () => {
  LocalNotifications.getPending.mockResolvedValue({notifications:[{id:400123456},{id:200012}]})
  api.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('offline'))
  await syncPlannedNotifications(3)
  expect(LocalNotifications.cancel).toHaveBeenLastCalledWith({notifications:[{id:200012}]})
})

it('retries scheduling when notification permission is granted later', async () => {
  const row = {id:12,date:new Date(Date.now()+3*86400000).toISOString(),description:'Rent',status:'planned',type:'expense',reminder_enabled:true}
  api.mockImplementation(path=>Promise.resolve(path.startsWith('/api/planned-transactions') ? [row] : {items:[]}))
  LocalNotifications.checkPermissions.mockResolvedValue({display:'denied'})
  await syncPlannedNotifications(3)
  expect(LocalNotifications.schedule).not.toHaveBeenCalled()
  LocalNotifications.checkPermissions.mockResolvedValue({display:'granted'})
  await syncPlannedNotifications(3)
  expect(LocalNotifications.schedule).toHaveBeenCalledOnce()
})
