import { beforeEach, expect, it, vi } from 'vitest'
import { notificationStorageKey, readNotificationSettings, saveNotificationSettings, stripNotificationSettings } from './notificationSettings'

vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'browser' } }))

beforeEach(() => window.localStorage.clear())

it('keeps a saved browser profile when account settings change', () => {
  const userId = 42
  saveNotificationSettings({ reminders_enabled: true, reminder_time: '09:30', reminder_interval_hours: 8 }, userId)
  expect(readNotificationSettings({ reminders_enabled: false, reminder_time: '20:00' }, userId)).toMatchObject({
    reminders_enabled: true,
    reminder_time: '09:30',
    reminder_interval_hours: 8,
  })
  expect(window.localStorage.getItem(notificationStorageKey(userId))).toContain('09:30')
})

it('does not send notification fields in general settings updates', () => {
  expect(stripNotificationSettings({ theme: 'dark', reminders_enabled: true, reminder_time: '08:00' })).toEqual({ theme: 'dark' })
})
