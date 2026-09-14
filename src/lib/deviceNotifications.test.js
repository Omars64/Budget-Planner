import { beforeEach, expect, it, vi } from 'vitest'
import { LocalNotifications } from '@capacitor/local-notifications'
import { cancelReminder, configureReminder, nextReminderAt, reminderTimes } from './deviceNotifications'

vi.mock('@capacitor/core',()=>({Capacitor:{isNativePlatform:()=>true,getPlatform:()=> 'android'},registerPlugin:()=>({configure:vi.fn()})}))
vi.mock('@capacitor/local-notifications',()=>({LocalNotifications:{cancel:vi.fn(),schedule:vi.fn(),createChannel:vi.fn(),checkPermissions:vi.fn(),requestPermissions:vi.fn()}}))
beforeEach(()=>{
  vi.clearAllMocks()
  LocalNotifications.requestPermissions.mockResolvedValue({display:'granted'})
  LocalNotifications.checkPermissions.mockResolvedValue({display:'granted'})
})
it('defaults to four-hour reminders and respects overnight quiet hours',()=>{
  expect(reminderTimes({reminder_time:'08:30'})).toEqual(['00:30','04:30','08:30','12:30','16:30','20:30'])
  expect(reminderTimes({reminder_time:'08:30',quiet_hours_enabled:true,quiet_start:'22:00',quiet_end:'08:00'})).toEqual(['08:30','12:30','16:30','20:30'])
  expect(reminderTimes({reminder_time:'09:00',reminder_interval_hours:24})).toEqual(['09:00'])
})
it('calculates the next reminder in Kuwait time',()=>{
  expect(nextReminderAt({reminder_time:'08:00',reminder_interval_hours:4},new Date('2026-09-14T04:00:00.000Z'))).toBe('2026-09-14T05:00:00.000Z')
})
it('schedules persistent Android reminders through the wake-capable native scheduler',async()=>{
  await configureReminder({reminders_enabled:true,reminder_time:'08:00',reminder_interval_hours:4})
  expect(LocalNotifications.cancel).toHaveBeenCalled()
  expect(LocalNotifications.schedule).not.toHaveBeenCalled()
})
it('preserves existing schedules when permission is denied and never prompts on resume',async()=>{
  LocalNotifications.requestPermissions.mockResolvedValue({display:'denied'})
  await expect(configureReminder({reminders_enabled:true})).rejects.toThrow('Notifications are blocked')
  expect(LocalNotifications.cancel).not.toHaveBeenCalled()
  LocalNotifications.checkPermissions.mockResolvedValue({display:'denied'})
  expect(await configureReminder({reminders_enabled:true},{requestPermission:false})).toBe(false)
  expect(LocalNotifications.requestPermissions).toHaveBeenCalledTimes(1)
})
it('clears the repeating and legacy reminders on sign-out',async()=>{
  await cancelReminder()
  expect(LocalNotifications.cancel.mock.calls[0][0].notifications).toContainEqual({id:1129})
  expect(LocalNotifications.schedule).not.toHaveBeenCalled()
})
