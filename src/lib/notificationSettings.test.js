import { beforeEach, expect, it, vi } from 'vitest'
import { notificationStorageKey, readNotificationSettings, saveNotificationSettings, stripNotificationSettings, scheduledNotificationsEnabled } from './notificationSettings'

vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'browser' } }))

beforeEach(() => window.localStorage.clear())

it('keeps scheduled alerts independent and resets their opt-in when accounts change', () => {
  expect(scheduledNotificationsEnabled()).toBe(false)
  saveNotificationSettings({ scheduled_notifications_enabled: true, update_notifications_enabled: false }, 42)
  expect(scheduledNotificationsEnabled()).toBe(true)
  expect(readNotificationSettings({}, 42).scheduled_notifications_enabled).toBe(true)
  expect(stripNotificationSettings({ currency: 'EUR', scheduled_notifications_enabled: true })).toEqual({ currency: 'EUR' })
  readNotificationSettings({}, 43)
  expect(scheduledNotificationsEnabled()).toBe(false)
})

it('keeps a saved browser profile when account settings change', () => {
  const userId = 42
  saveNotificationSettings({ reminders_enabled: true, reminder_time: '09:30', reminder_interval_hours: 8, upcoming_reminders_enabled: true, upcoming_reminder_days: 2, upcoming_reminder_time: '07:45' }, userId)
  expect(readNotificationSettings({ reminders_enabled: false, reminder_time: '20:00' }, userId)).toMatchObject({
    reminders_enabled: true,
    reminder_time: '09:30',
    reminder_interval_hours: 8,
    upcoming_reminders_enabled: true,
    upcoming_reminder_days: 2,
    upcoming_reminder_time: '07:45',
  })
  expect(window.localStorage.getItem(notificationStorageKey(userId))).toContain('09:30')
})

it('does not send notification fields in general settings updates', () => {
  expect(stripNotificationSettings({ theme: 'dark', reminders_enabled: true, reminder_time: '08:00', upcoming_reminder_days: 2 })).toEqual({ theme: 'dark' })
})
