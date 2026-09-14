import { Capacitor } from '@capacitor/core'

export const notificationSettingsChangedEvent = 'budgetly:notification-settings-changed'

export const notificationSettingKeys = [
  'reminders_enabled',
  'reminder_interval_hours',
  'reminder_time',
  'quiet_hours_enabled',
  'quiet_start',
  'quiet_end',
  'reminder_topics',
]

const allowedIntervals = [1, 2, 3, 4, 6, 8, 12, 24]
const allowedTopics = ['daily', 'budgets', 'bills', 'debts']

const platformName = () => {
  try {
    return Capacitor.getPlatform() === 'android' ? 'android' : 'browser'
  } catch {
    return 'browser'
  }
}

const normalize = (source = {}) => {
  const interval = Number(source.reminder_interval_hours)
  const topics = Array.isArray(source.reminder_topics)
    ? [...new Set(source.reminder_topics.filter(topic => allowedTopics.includes(topic)))]
    : ['daily']
  const time = typeof source.reminder_time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(source.reminder_time)
    ? source.reminder_time
    : '20:00'
  return {
    reminders_enabled: Boolean(source.reminders_enabled),
    reminder_interval_hours: allowedIntervals.includes(interval) ? interval : 4,
    reminder_time: time,
    quiet_hours_enabled: Boolean(source.quiet_hours_enabled),
    quiet_start: typeof source.quiet_start === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(source.quiet_start) ? source.quiet_start : '22:00',
    quiet_end: typeof source.quiet_end === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(source.quiet_end) ? source.quiet_end : '08:00',
    reminder_topics: topics.length ? topics : ['daily'],
  }
}

export const notificationStorageKey = userId => `flowbudget-notifications-${platformName()}-${userId}`

export function readNotificationSettings(source, userId) {
  const fallback = normalize(source)
  if (!userId || typeof window === 'undefined') return fallback
  try {
    const stored = window.localStorage.getItem(notificationStorageKey(userId))
    if (stored) return normalize(JSON.parse(stored))
    window.localStorage.setItem(notificationStorageKey(userId), JSON.stringify(fallback))
  } catch {
    // Storage can be unavailable in private browsing or a restricted WebView.
  }
  return fallback
}

export function saveNotificationSettings(source, userId) {
  const next = normalize(source)
  if (userId && typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(notificationStorageKey(userId), JSON.stringify(next))
      window.dispatchEvent(new window.CustomEvent(notificationSettingsChangedEvent))
    } catch {
      // The native scheduler still receives the settings for this session.
    }
  }
  return next
}

export function stripNotificationSettings(source = {}) {
  return Object.fromEntries(Object.entries(source).filter(([key]) => !notificationSettingKeys.includes(key)))
}
