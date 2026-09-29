import { AlertTriangle, ArrowRight, BellDot, CalendarClock, Gauge, HandCoins, RefreshCw, Target } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import EmptyState from '../components/EmptyState'

const icons = { plan: CalendarClock, budget: Gauge, debt: HandCoins, goal: Target }
const severityLabels = { danger: 'Needs attention', warning: 'Worth checking', info: 'Coming up' }

export default function Attention() {
  const [data, setData] = useState({ items: [], count: 0, has_more: false })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(async signal => {
    setLoading(true)
    setError('')
    try {
      const result = await api('/api/attention', { signal })
      if (!signal?.aborted) setData(result)
    } catch (err) {
      if (!signal?.aborted) setError(err.message || 'Could not load attention items.')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])
  useEffect(() => {
    const controller = new window.AbortController()
    void load(controller.signal)
    const refresh = () => void load(controller.signal)
    window.addEventListener('focus', refresh)
    return () => { controller.abort(); window.removeEventListener('focus', refresh) }
  }, [load])

  return <div className="attention-page stack gap-20">
    <section className="section-intro glass attention-intro">
      <div><p className="eyebrow">Your next best actions</p><h2>Attention</h2><p className="muted">A quiet list of things worth checking, so nothing important gets lost.</p></div>
      <button className="button ghost" onClick={() => void load()} disabled={loading} aria-label="Refresh attention list" title="Refresh attention list"><RefreshCw size={17} className={loading ? 'spin' : ''}/><span>Refresh</span></button>
    </section>
    {error && <div className="form-error" role="alert">{error}<button className="button ghost small" onClick={() => void load()}>Retry</button></div>}
    {!loading && !error && data.items.length === 0 && <section className="panel glass"><EmptyState title="You are all caught up" text="Budgetly will place overdue plans, budget pressure, and nearby goals or debt dates here when they need your attention." icon={<BellDot/>}/></section>}
    {loading && <div className="panel glass attention-loading" role="status">Checking your records...</div>}
    {!loading && !error && data.items.length > 0 && <section className="panel glass attention-list" aria-label="Items needing attention">
      <div className="attention-list-head"><div><p className="eyebrow">{data.count} item{data.count === 1 ? '' : 's'}</p><h3>Worth a look</h3></div><AlertTriangle size={20}/></div>
      <div className="attention-items">{data.items.map(row => { const Icon = icons[row.kind] || BellDot; return <article className={`attention-item ${row.severity}`} key={row.id}>
        <span className="attention-icon"><Icon size={19}/></span><div className="attention-copy"><span className="attention-label">{severityLabels[row.severity] || 'Review'}{row.shared ? ' · Shared' : ''}</span><h4>{row.title}</h4><p>{row.detail}</p></div><Link className="button ghost small attention-action" to={row.path}>{row.action_label || 'Open'}<ArrowRight size={15}/></Link>
      </article> })}</div>
      {data.has_more && <p className="muted attention-more">Showing the 25 most important items. Open the related pages for the full detail.</p>}
    </section>}
  </div>
}
