import { api, auth, jsonBody } from './api'
import { version } from '../../package.json'

const pages = new Set(['/', '/transactions', '/wallets', '/settings', '/ask-ai', '/upcoming', '/planner', '/budgets', '/analytics', '/notes', '/attention', '/calendar', '/admin', '/feedback', '/shared-transactions', '/goals', '/bank-messages'])
const sent = new Map()
export function reportClientFailure(code) {
  if (!auth.token || !['render', 'unhandled', 'asset'].includes(code)) return
  if (Date.now() - (sent.get(code) || 0) < 60000) return
  sent.set(code, Date.now())
  const route = window.location.hash.slice(1).split('?')[0] || '/'
  void api('/api/diagnostics/client-error', { method: 'POST', ...jsonBody({code, version, page: pages.has(route) ? route : 'other'}) }).catch(() => {})
}

export function installClientDiagnostics() {
  const error = event => reportClientFailure(event.target && event.target !== window ? 'asset' : 'unhandled')
  const rejection = () => reportClientFailure('unhandled')
  window.addEventListener('error', error, true)
  window.addEventListener('unhandledrejection', rejection)
  return () => { window.removeEventListener('error', error, true); window.removeEventListener('unhandledrejection', rejection) }
}
