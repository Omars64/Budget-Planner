import { useSyncExternalStore } from 'react'
import { api } from './api'
import { configureClientIdle, clientIsActive, recordClientInteraction, subscribeClientResume } from './clientActivity'

export const RESOURCE_POLICY_EVENT = 'budgetly:resource-policy'
const DEFAULT_SECONDS = 60
const POLICY_REFRESH_MS = 15 * 60 * 1000
let policy = { client_poll_seconds: DEFAULT_SECONDS, client_idle_minutes: 30 }
const listeners = new Set()
let listening = false

export const readResourcePolicy = () => policy
export const canReadResources = () => document.visibilityState !== 'hidden' && navigator.onLine !== false && clientIsActive()

export function updateResourcePolicy(config) {
  const next = { ...policy }
  const seconds = config?.client_poll_seconds
  const minutes = config?.client_idle_minutes
  if (Number.isInteger(seconds) && seconds >= 15 && seconds <= 300) next.client_poll_seconds = seconds
  if (Number.isInteger(minutes) && minutes >= 5 && minutes <= 60) next.client_idle_minutes = minutes
  if (next.client_poll_seconds === policy.client_poll_seconds && next.client_idle_minutes === policy.client_idle_minutes) return
  policy = next
  configureClientIdle(policy.client_idle_minutes)
  listeners.forEach(listener => listener())
}

const policyEvent = event => updateResourcePolicy(event.detail?.config || event.detail)
function subscribe(listener) {
  listeners.add(listener)
  if (!listening) { window.addEventListener(RESOURCE_POLICY_EVENT, policyEvent); listening = true }
  return () => {
    listeners.delete(listener)
    if (!listeners.size) { window.removeEventListener(RESOURCE_POLICY_EVENT, policyEvent); listening = false }
  }
}

export function useResourcePolicy() {
  return useSyncExternalStore(subscribe, readResourcePolicy, readResourcePolicy)
}

// Schedule after completion; lifecycle events share the same due time and in-flight lock.
export function startReadPolling(read, { immediate = true, initialDelay = 0, recurring = true, intervalMs } = {}) {
  let stopped = false
  let pending = false
  let refreshRequested = false
  let explicitDue = false
  let timer
  let lastCompleted = null
  const started = Date.now()
  let due = started + (immediate ? initialDelay : (intervalMs ?? policy.client_poll_seconds * 1000))
  const interval = () => intervalMs ?? policy.client_poll_seconds * 1000
  const schedule = () => {
    window.clearTimeout(timer)
    if (stopped || pending || !canReadResources() || due === null) return
    if (!recurring && lastCompleted !== null && Date.now() < due) return
    timer = window.setTimeout(run, Math.max(0, due - Date.now()))
  }
  const run = async () => {
    if (stopped || pending || !canReadResources()) return
    if (Date.now() < due) { schedule(); return }
    explicitDue = false
    pending = true
    try { await read() } catch { /* Callers own their read error state. */ }
    finally {
      pending = false
      lastCompleted = Date.now()
      const explicit = refreshRequested
      refreshRequested = false
      explicitDue = explicit
      due = explicit ? lastCompleted : lastCompleted + interval()
      if (recurring || explicit) schedule()
    }
  }
  const changed = () => {
    // Policy updates must not postpone an explicit refresh waiting for connectivity.
    if (!explicitDue) {
      if (lastCompleted !== null) due = lastCompleted + interval()
      else if (!immediate) due = started + interval()
    }
    schedule()
  }
  const unsubscribe = subscribe(changed)
  const unsubscribeActivity = subscribeClientResume(() => {
    if (lastCompleted !== null) due = Math.min(due, Date.now())
    schedule()
  })
  window.addEventListener('focus', schedule)
  window.addEventListener('online', schedule)
  window.addEventListener('offline', schedule)
  document.addEventListener('visibilitychange', schedule)
  schedule()
  const stop = () => {
    stopped = true
    window.clearTimeout(timer)
    unsubscribe()
    unsubscribeActivity()
    window.removeEventListener('focus', schedule)
    window.removeEventListener('online', schedule)
    window.removeEventListener('offline', schedule)
    document.removeEventListener('visibilitychange', schedule)
  }
  stop.refresh = () => {
    if (stopped) return
    recordClientInteraction()
    if (pending) refreshRequested = true
    else { explicitDue = true; due = Date.now(); schedule() }
  }
  return stop
}

// One loader per signed-in App session; refreshes are bounded and never query user data.
export function startResourcePolicySession() {
  let alive = true
  let revision = 0
  const unsubscribe = subscribe(() => { revision += 1 })
  const stop = startReadPolling(async () => {
    const requestedRevision = revision
    const config = await api('/api/runtime-policy')
    if (alive && revision === requestedRevision) updateResourcePolicy(config)
  }, { intervalMs: POLICY_REFRESH_MS })
  return () => { alive = false; stop(); unsubscribe() }
}

export const policyDefaults = { client_idle_minutes: 30, ai_global_daily_requests: 50, ai_user_daily_requests: 50, ai_global_minute_requests: 15, ai_max_output_tokens: 1800, release_notifications_enabled: true, scheduled_notifications_enabled: true, upcoming_notifications_enabled: true, notification_batch_size: 5, backup_interval_hours: 24, backup_skip_unchanged: false, client_poll_seconds: 60, idle_recheck_minutes: 180, database_probe_minutes: 60, scheduler_enabled: true, scheduler_interval_minutes: 1 }
