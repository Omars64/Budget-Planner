import { useEffect, useState } from 'react'
import { api, readCached } from './api'
import { readView, writeView } from './viewState'
import { startReadPolling } from './resourcePolicy'

const PAGE_SIZE = 100

export function ledgerQuery(filters, offset = 0) {
  const query = new URLSearchParams({ search: filters.search, tx_type: filters.type, sort: filters.sort, limit: String(PAGE_SIZE + 1), offset: String(offset) })
  if (filters.wallet) query.set('wallet_id', filters.wallet)
  if (filters.month) query.set('month', filters.month)
  if (filters.reporting_from) query.set('reporting_from', filters.reporting_from)
  if (filters.reporting_to) query.set('reporting_to', filters.reporting_to)
  if (filters.category) query.set('category_id', filters.category)
  if (filters.scope) query.set('scope', filters.scope)
  if (filters.exclude_opening) query.set('exclude_opening', 'true')
  if (filters.date_from) query.set('date_from', filters.date_from)
  if (filters.date_to) query.set('date_to', filters.date_to)
  return query.toString()
}

export default function useLedger(endpoint, filters, refreshKey, poll = false, viewKey) {
  const filterKey = ledgerQuery(filters)
  const [pagination, setPagination] = useState(() => viewKey ? readView(`${viewKey}:page`, {key:filterKey,offset:0}) : {key:filterKey,offset:0})
  if (pagination.key !== filterKey) setPagination({ key: filterKey, offset: 0 })
  const offset = pagination.key === filterKey ? pagination.offset : 0
  useEffect(() => { if (viewKey) writeView(`${viewKey}:page`, {key:filterKey,offset}) }, [viewKey, filterKey, offset])
  const path = `${endpoint}?${ledgerQuery(filters, offset)}`
  const [result, setResult] = useState(() => ({ path, viewKey, rows: readCached(path), error: '' }))
  const [retry, setRetry] = useState(0)
  const [busy, setBusy] = useState(true)

  useEffect(() => {
    const controller = new AbortController()
    let pending = false
    const sync = async () => {
      if (pending) return
      pending = true
      setBusy(true)
      try {
        const rows = await api(path, { signal: controller.signal })
        if (!controller.signal.aborted) setResult({ path, viewKey, rows, error: '', updatedAt: Date.now() })
      } catch (error) {
        if (!controller.signal.aborted) setResult(previous => {
          const retain = previous.path === path && previous.viewKey === viewKey && ![401, 403].includes(error.status)
          return { path, viewKey, rows: retain ? previous.rows : undefined, updatedAt: retain ? previous.updatedAt : undefined, error: error.message }
        })
      } finally {
        pending = false
        if (!controller.signal.aborted) setBusy(false)
      }
    }
    const stop = startReadPolling(sync, { initialDelay: 180, recurring: poll })
    return () => {
      controller.abort()
      stop()
    }
  }, [path, refreshKey, retry, poll, viewKey])

  const sameView = result.path === path && result.viewKey === viewKey
  const current = sameView ? result : { rows: readCached(path), error: '' }
  return {
    rows: (current.rows || []).slice(0, PAGE_SIZE),
    loading: !current.rows && !current.error,
    busy: busy || !sameView,
    error: current.error,
    updatedAt: current.updatedAt,
    hasMore: (current.rows?.length || 0) > PAGE_SIZE,
    page: offset / PAGE_SIZE + 1,
    previous: () => setPagination({ key: filterKey, offset: Math.max(0, offset - PAGE_SIZE) }),
    next: () => setPagination({ key: filterKey, offset: offset + PAGE_SIZE }),
    retry: () => setRetry(value => value + 1),
  }
}
