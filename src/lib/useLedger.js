import { useEffect, useState } from 'react'
import { api, readCached } from './api'

const PAGE_SIZE = 100

export function ledgerQuery(filters, offset = 0) {
  const query = new URLSearchParams({ search: filters.search, tx_type: filters.type, sort: filters.sort, limit: String(PAGE_SIZE + 1), offset: String(offset) })
  if (filters.wallet) query.set('wallet_id', filters.wallet)
  if (filters.month) query.set('month', filters.month)
  return query.toString()
}

export default function useLedger(endpoint, filters, refreshKey, poll = false) {
  const filterKey = ledgerQuery(filters)
  const [pagination, setPagination] = useState({ key: filterKey, offset: 0 })
  if (pagination.key !== filterKey) setPagination({ key: filterKey, offset: 0 })
  const offset = pagination.key === filterKey ? pagination.offset : 0
  const path = `${endpoint}?${ledgerQuery(filters, offset)}`
  const [result, setResult] = useState(() => ({ path, rows: readCached(path), error: '' }))
  const [retry, setRetry] = useState(0)
  const [busy, setBusy] = useState(true)

  useEffect(() => {
    const controller = new AbortController()
    let pending = false
    const sync = async () => {
      if (pending || document.visibilityState === 'hidden') return
      pending = true
      setBusy(true)
      try {
        const rows = await api(path, { signal: controller.signal })
        if (!controller.signal.aborted) setResult({ path, rows, error: '' })
      } catch (error) {
        if (!controller.signal.aborted) setResult(previous => ({ path, rows: previous.path === path && ![401, 403].includes(error.status) ? previous.rows : undefined, error: error.message }))
      } finally {
        pending = false
        if (!controller.signal.aborted) setBusy(false)
      }
    }
    const timer = setTimeout(sync, 180)
    const interval = poll ? setInterval(sync, 5000) : null
    window.addEventListener('focus', sync)
    document.addEventListener('visibilitychange', sync)
    return () => {
      controller.abort()
      clearTimeout(timer)
      if (interval) clearInterval(interval)
      window.removeEventListener('focus', sync)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [path, refreshKey, retry, poll])

  const current = result.path === path ? result : { rows: readCached(path), error: '' }
  return {
    rows: (current.rows || []).slice(0, PAGE_SIZE),
    loading: !current.rows && !current.error,
    busy: busy || result.path !== path,
    error: current.error,
    hasMore: (current.rows?.length || 0) > PAGE_SIZE,
    page: offset / PAGE_SIZE + 1,
    previous: () => setPagination({ key: filterKey, offset: Math.max(0, offset - PAGE_SIZE) }),
    next: () => setPagination({ key: filterKey, offset: offset + PAGE_SIZE }),
    retry: () => setRetry(value => value + 1),
  }
}
