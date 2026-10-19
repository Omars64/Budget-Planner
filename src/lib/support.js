export const SUPPORT_URL = 'https://ko-fi.com/omarsolanki'
const dismissed = new Set()
const key = userId => `budgetly:support-dismissed:${userId}`

export function supportDismissed(userId) {
  if (dismissed.has(userId)) return true
  try { return sessionStorage.getItem(key(userId)) === 'true' } catch { return false }
}

export function dismissSupport(userId) {
  dismissed.add(userId)
  try { sessionStorage.setItem(key(userId), 'true') } catch { /* In-memory dismissal still works. */ }
}

export function resetSupportPrompt(userId) {
  dismissed.delete(userId)
  try { sessionStorage.removeItem(key(userId)) } catch { /* Sign-in still succeeds without storage. */ }
}
