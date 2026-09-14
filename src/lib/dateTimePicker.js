// Calendar arithmetic is UTC-only; these dates represent civil days, not instants.
export function calendarDate(year, month, day = 1) {
  const date = new Date(0)
  date.setUTCHours(12, 0, 0, 0)
  date.setUTCFullYear(year, month, day)
  return date
}

export const dayValue = date => date.toISOString().slice(0, 10)
export const calendarLabel = (date, options) => new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }).format(date)
export const padTime = value => String(value).padStart(2, '0')

export function parseDateTime(value) {
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value || '')
  if (!parts) return null
  const [, year, month, day, hour, minute] = parts.map(Number)
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null
  const date = calendarDate(year, month - 1, day)
  if (dayValue(date) !== value.slice(0, 10)) return null
  return { date, hour: hour % 12 || 12, minute, period: hour < 12 ? 'AM' : 'PM' }
}

export function timeValue({ hour, minute, period }) {
  return `${padTime(hour % 12 + (period === 'PM' ? 12 : 0))}:${padTime(minute)}`
}

export function dialValue(x, y, count) {
  const angle = (Math.atan2(x, -y) + Math.PI * 2) % (Math.PI * 2)
  const value = Math.round(angle / (Math.PI * 2) * count) % count
  return count === 12 ? value || 12 : value
}

export function dialPosition(value, count) {
  const angle = value / count * Math.PI * 2
  return { left: `${50 + Math.sin(angle) * 38}%`, top: `${50 - Math.cos(angle) * 38}%` }
}
