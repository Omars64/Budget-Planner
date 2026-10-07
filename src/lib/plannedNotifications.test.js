import { beforeEach, expect, it, vi } from 'vitest'
import { LocalNotifications } from '@capacitor/local-notifications'
import { api } from './api'
import { readNotificationSettings } from './notificationSettings'
import { cancelPlannedNotifications, reminderAt, syncPlannedNotifications } from './plannedNotifications'

vi.mock('@capacitor/local-notifications',()=>({LocalNotifications:{getPending:vi.fn(),cancel:vi.fn(),schedule:vi.fn(),checkPermissions:vi.fn()}}))
vi.mock('./api',()=>({api:vi.fn()}))
vi.mock('./deviceNotifications',()=>({isNativeApp:()=>true}))
vi.mock('./notificationSettings',()=>({readNotificationSettings:vi.fn()}))

beforeEach(async()=>{
  vi.clearAllMocks()
  LocalNotifications.getPending.mockResolvedValue({notifications:[]})
  LocalNotifications.checkPermissions.mockResolvedValue({display:'granted'})
  await cancelPlannedNotifications()
  readNotificationSettings.mockReturnValue({upcoming_reminders_enabled:true,upcoming_reminder_days:0,upcoming_reminder_time:'09:00'})
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
  expect(notifications[0].body).toContain('Subscription')
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
