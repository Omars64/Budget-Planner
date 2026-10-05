import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'

export default function WeeklySummary({value,fmt}) {
  const filters = {date_from:`${value.start}T00:00:00`,date_to:`${value.end}T23:59:59.999999`,month:'',exclude_opening:true}
  const difference = Math.round((value.expense-value.previous_expense)*1000)/1000
  return <details className="overview-disclosure weekly-summary"><summary>Last 7 days</summary>
    <div className="weekly-totals"><Link to="/transactions" state={{aiFilters:{...filters,type:'income'}}}><span>Money in</span><strong>{fmt(value.income)}</strong></Link><Link to="/transactions" state={{aiFilters:{...filters,type:'expense'}}}><span>Spent</span><strong>{fmt(value.expense)}</strong></Link></div>
    {!value.count ? <p className="muted">No income or expenses recorded in the last 7 days.</p> : <><p className="muted">{difference === 0 ? 'Spending matches the previous 7 days.' : value.previous_expense === 0 ? 'No spending recorded in the previous 7 days.' : `${fmt(Math.abs(difference))} ${difference > 0 ? 'more' : 'less'} spent than the previous 7 days.`}</p>{value.top_category && <Link className="weekly-action" to="/transactions" state={{aiFilters:{...filters,type:'expense',category:String(value.top_category.id)}}}>Review {value.top_category.name}<ArrowRight size={16}/></Link>}</>}
  </details>
}
