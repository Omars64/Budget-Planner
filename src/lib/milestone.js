import { successHaptic } from './comfort'
import { readWorkspacePreferences } from './workspacePreferences'

export function celebrateMilestone(key, title, name, userId) {
  if (userId && readWorkspacePreferences(userId).goalCelebrations === false) return
  try { if (localStorage.getItem(`budgetly:milestone:${key}`)) return; localStorage.setItem(`budgetly:milestone:${key}`, 'seen') } catch { /* Completion still deserves feedback. */ }
  window.dispatchEvent(new window.CustomEvent('budgetly:milestone', {detail:{title,name}}))
  successHaptic()
}
