const key = userId => `budgetly:upcoming-push:${userId}`
export function upcomingPushActive(userId) {
  try { return sessionStorage.getItem(key(userId)) === 'true' } catch { return false }
}
export function setUpcomingPushActive(userId, enabled) {
  try { sessionStorage.setItem(key(userId), String(Boolean(enabled))) } catch { /* Local reminders remain available. */ }
}
