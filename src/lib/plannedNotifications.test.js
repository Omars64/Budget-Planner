import { expect, it } from 'vitest'
import { reminderAt } from './plannedNotifications'

it('uses Kuwait calendar days and the chosen time before an expense', () => {
  const row = {date:'2026-09-30T10:00:00+03:00'}
  expect(reminderAt(row,{upcoming_reminder_days:1,upcoming_reminder_time:'09:00'}).toISOString()).toBe('2026-09-29T06:00:00.000Z')
})

it('never puts a same-day reminder after the expense', () => {
  const row = {date:'2026-09-30T10:00:00+03:00'}
  expect(reminderAt(row,{upcoming_reminder_days:0,upcoming_reminder_time:'18:00'}).toISOString()).toBe('2026-09-30T06:55:00.000Z')
})
