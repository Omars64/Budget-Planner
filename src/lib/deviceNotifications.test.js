import { beforeEach, expect, it, vi } from 'vitest'
import { LocalNotifications } from '@capacitor/local-notifications'
import { cancelReminder, configureReminder, reminderTimes } from './deviceNotifications'

vi.mock('@capacitor/core',()=>({Capacitor:{isNativePlatform:()=>true,getPlatform:()=> 'android'}}))
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
it('schedules persistent daily slots without requiring exact-alarm access',async()=>{
  await configureReminder({reminders_enabled:true,reminder_time:'08:00',reminder_interval_hours:4})
  const rows=LocalNotifications.schedule.mock.calls[0][0].notifications
  expect(rows).toHaveLength(6)
  expect(new Set(rows.map(row=>row.id)).size).toBe(6)
  for(const row of rows){
    expect(row.schedule.on).toEqual({hour:expect.any(Number),minute:0,second:0})
    expect(row.schedule.at).toBeUndefined()
    expect(row.isExactNotification).toBe(false)
    expect(row.channelId).toBe('budgetly-reminders')
  }
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
