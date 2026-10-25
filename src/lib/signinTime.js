export function signinTime(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Not recorded'
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
