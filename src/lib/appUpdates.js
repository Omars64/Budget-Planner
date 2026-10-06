import { Capacitor, registerPlugin } from '@capacitor/core'
import { publicApiUrl } from './api'
import { version } from '../../package.json'
import { validateReleaseNotes } from './releaseNotes'

export function newerVersion(candidate, current = version) {
  if (!/^\d+\.\d+\.\d+$/.test(candidate) || !/^\d+\.\d+\.\d+$/.test(current)) return false
  const left = candidate.split('.').map(Number), right = current.split('.').map(Number)
  for (let i = 0; i < 3; i++) { if (left[i] !== right[i]) return left[i] > right[i] }
  return false
}
export async function fetchWebRelease(signal) {
  const response = await fetch(publicApiUrl('/api/app-updates/web'), { signal, cache: 'no-store', credentials: 'omit' })
  if (!response.ok) throw new Error('Could not check for updates.')
  const body = await response.text()
  if (body.length > 1024) throw new Error('Invalid web update information.')
  const data = JSON.parse(body)
  if (!/^\d+\.\d+\.\d+$/.test(data.version)) throw new Error('Invalid web update information.')
  return { version: data.version }
}

export const RELEASES_URL = 'https://github.com/Omars64/Budget-Planner/releases'
export const MANIFEST_URL = publicApiUrl('/api/app-updates/latest')
export const AppUpdater = registerPlugin('BudgetlyUpdater')
export const androidUpdatesAvailable = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'

export function validateRelease(value) {
  if (!value || value.schema !== 1 || value.packageId !== 'com.flowbudget.app' ||
      !/^\d+\.\d+\.\d+$/.test(value.version) || !Number.isSafeInteger(value.versionCode) || value.versionCode < 1 ||
      !Number.isSafeInteger(value.size) || value.size < 1 || value.size > 268435456 ||
      !/^[a-f0-9]{64}$/.test(value.sha256)) throw new Error('The published update information is invalid.')
  let url
  try { url = new URL(value.url) } catch { throw new Error('The update download address is invalid.') }
  const prefix = '/Omars64/Budget-Planner/releases/download/'
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password ||
      url.search || url.hash || !url.pathname.startsWith(prefix) || !url.pathname.endsWith('.apk') ||
      /\.\.|%2f/i.test(url.pathname) ||
      url.pathname.slice(prefix.length).split('/').length !== 2) throw new Error('The update is not from the official Budgetly repository.')
  return { schema: 1, packageId: value.packageId, version: value.version, versionCode: value.versionCode,
    size: value.size, sha256: value.sha256, url: url.href,
    ...(value.notes ? { notes: validateReleaseNotes(value.notes) } : {}) }
}

export async function fetchRelease(signal) {
  const response = await fetch(MANIFEST_URL, { signal, cache: 'no-store', credentials: 'omit' })
  if (response.status === 404) return null
  if (!response.ok) throw new Error('Could not check for updates. Try again when connected.')
  const body = await response.text()
  if (body.length > 16384) throw new Error('The update information is too large.')
  return validateRelease(JSON.parse(body))
}
