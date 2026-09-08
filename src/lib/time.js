export const TIME_ZONE = 'Asia/Kuwait'
const parts = value => Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
}).formatToParts(instant(value)).map(p => [p.type, p.value]))

// Legacy ledger timestamps had no offset and represent Kuwait wall time.
export function instant(value = new Date()) {
  if (value instanceof Date) return value
  const text = String(value)
  return new Date(/^\d{4}-\d{2}-\d{2}T/.test(text) && !/(Z|[+-]\d{2}:\d{2})$/.test(text) ? `${text}+03:00` : text)
}
export function dateInput(value = new Date()) {
  const p = parts(value)
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
}
export const saveDate = value => new Date(`${value}+03:00`).toISOString()
export const dateKey = value => dateInput(value).slice(0, 10)
export const clockTime = value => dateInput(value).slice(11, 16)
export const showTime = value => new Intl.DateTimeFormat('en-GB', {timeZone: TIME_ZONE, dateStyle:'medium', timeStyle:'short'}).format(instant(value))
// For date-fns formatting only, never use this value for persistence.
export const displayDate = value => new Date(dateInput(value))
