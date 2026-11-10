import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { api, money } from '../lib/api'
import { dateInput } from '../lib/time'
import { useApp } from '../App'
import AppMonthField from '../components/AppMonthField'
import PageActions from '../components/PageActions'

const categoryColor = color => /^#[0-9a-f]{6}$/i.test(color) ? color : '#94a3b8'

export default function Spending() {
  const { settings, refreshKey } = useApp()
  const [month, setMonth] = useState(() => dateInput().slice(0,7))
  const [view, setView] = useState('overall')
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setError('')
    api(`/api/dashboard?month=${month}`, {signal:controller.signal})
      .then(result => { if (!controller.signal.aborted) setData(result) })
      .catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [month,refreshKey,retry])

  const loaded = data?.month === month
  const categories = loaded ? data.category_spending.filter(item => item.value > 0) : []
  const total = categories.reduce((sum,item) => sum + item.value,0)
  let position = 0
  const segments = categories.map(item => {
    const start = position
    position += item.value / total * 100
    return `${categoryColor(item.color)} ${start}% ${position}%`
  })
  const fmt = value => money(value,settings.currency,settings.compact_numbers)
  const expenses = {month,type:'expense',exclude_opening:true}
  return <>
    <PageActions><AppMonthField required aria-label="Spending month" value={month} onChange={event => setMonth(event.target.value)}/></PageActions>
    <div className="palette-dark-section spending-hero">
      <div className="spending-donut" style={{background:segments.length ? `conic-gradient(${segments.join(',')})` : undefined}}>
        <div><strong>{loaded ? fmt(data.expense) : '—'}</strong><span>Total spent</span></div>
      </div>
    </div>
    <section className="palette-sheet spending-sheet">
      <div className="poc-pills" role="group" aria-label="Spending view">
        <button type="button" aria-pressed={view === 'overall'} onClick={() => setView('overall')}>Overall</button>
        <button type="button" aria-pressed={view === 'category'} onClick={() => setView('category')}>By category</button>
      </div>
      {error && <div className="form-error" role="alert">{error}<button type="button" className="button ghost small" onClick={() => setRetry(value => value + 1)}>Retry</button></div>}
      {!loaded && !error && <p role="status">Loading monthly spending…</p>}
      {loaded && (view === 'category' ? <div className="poc-list">
        <h3>Spending by category</h3>
        {categories.length ? categories.map(item => <Link className="poc-line" to="/transactions" key={item.id} state={{ aiFilters:{...expenses,category:String(item.id)} }}>
          <span className="spending-dot" style={{background:categoryColor(item.color)}} aria-hidden="true"/><strong>{item.name}</strong><strong>{fmt(item.value)}</strong>
        </Link>) : <p className="muted">No spending assigned to this month.</p>}
      </div> : <>
        <div className="poc-section-heading"><h3>Monthly activity</h3><Link className="poc-link" to="/transactions" state={{ aiFilters:expenses }}>See expenses <ArrowRight size={16} aria-hidden="true"/></Link></div>
        <div className="poc-metric-line"><span>Money in</span><strong className="tx-amount income">{fmt(data.income)}</strong></div>
        <div className="poc-metric-line"><span>Spent</span><strong className="tx-amount expense">{fmt(data.expense)}</strong></div>
      </>)}
      <details className="poc-disclosure"><summary>How this is calculated</summary><p className="muted">Spending includes expenses assigned to the selected month. Transfers and starting balances are excluded from spending.</p></details>
    </section>
  </>
}
