import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ReceiptText } from 'lucide-react'
import { api, money } from '../lib/api'
import { useApp } from '../App'
import EmptyState from '../components/EmptyState'
import ProgressBar from '../components/ProgressBar'

export default function Analytics() {
  const { settings, refreshKey } = useApp()
  const [trend, setTrend] = useState(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setError('')
    api('/api/analytics?months=6', { signal:controller.signal })
      .then(data => { if (!controller.signal.aborted) setTrend(data.trend) })
      .catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [refreshKey,retry])

  const maximum = Math.max(1,...(trend || []).flatMap(row => [row.income,row.expense]))
  const fmt = value => money(value, settings.currency, settings.compact_numbers)
  const label = month => new Date(month + '-01T12:00:00').toLocaleDateString(undefined, { month:'long', year:'numeric' })

  return <div className="poc-analytics stack gap-12">
    <div className="poc-section-heading"><h3>Monthly trends</h3><Link className="poc-link" to="/spending">Spending tracker <ArrowRight size={16} aria-hidden="true"/></Link></div>
    {error && <div className="form-error" role="alert">{error}<button type="button" className="button ghost small" onClick={() => setRetry(value => value + 1)}>Retry</button></div>}
    {!trend && !error && <div className="skeleton-page"><div/><div/></div>}
    {trend?.length === 0 && <EmptyState title="No monthly trends yet" text="Record a transaction to start tracking activity."/>}
    {trend?.map(row => <article key={row.month_key} className="poc-month-card">
      <h3>{label(row.month_key)}</h3>
      <div className="poc-metric-line"><span>Money in</span><strong className="tx-amount income">{fmt(row.income)}</strong></div>
      <ProgressBar value={row.income / maximum * 100} label="Income"/>
      <div className="poc-metric-line"><span>Spent</span><strong className="tx-amount expense">{fmt(row.expense)}</strong></div>
      <ProgressBar value={row.expense / maximum * 100} label="Spending" warning/>
      <Link className="poc-line" to="/transactions" state={{ aiFilters:{month:row.month_key} }}><span className="poc-marker"><ReceiptText size={18} aria-hidden="true"/></span><strong>View month’s transactions</strong><ArrowRight size={16} aria-hidden="true"/></Link>
    </article>)}
  </div>
}
