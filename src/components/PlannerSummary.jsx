import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { api } from '../lib/api'

export default function PlannerSummary({refreshKey, fmt}) {
  const [value,setValue] = useState(null)
  useEffect(() => {
    const controller = new AbortController()
    api('/api/planner/summary',{signal:controller.signal}).then(result => { if (!controller.signal.aborted) setValue(Number.isFinite(Number(result.available_to_spend)) ? result : null) }).catch(() => { if (!controller.signal.aborted) setValue(null) })
    return () => controller.abort()
  },[refreshKey])
  return <Link className="overview-attention-link planner-summary" to="/planner"><span>{value ? <><strong>{fmt(value.available_to_spend)} available to spend</strong><small>{value.shortfall_date ? `Possible shortfall ${value.shortfall_date}` : '30-day estimate'}</small></> : 'Open cash-flow planner'}</span><ArrowRight size={18}/></Link>
}
