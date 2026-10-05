import { dateKey } from './time'

export function weeklySummary(rows, now = new Date()) {
  const today = dateKey(now)
  const shift = days => {
    const value = new Date(`${today}T12:00:00Z`)
    value.setUTCDate(value.getUTCDate() + days)
    return value.toISOString().slice(0,10)
  }
  const start = shift(-6), previousStart = shift(-13)
  const current = rows.filter(row => !row.is_opening_balance && row.date.slice(0,10) >= start && row.date.slice(0,10) <= today)
  const previous = rows.filter(row => !row.is_opening_balance && row.date.slice(0,10) >= previousStart && row.date.slice(0,10) < start)
  const total = (items, type) => Math.round(items.filter(row => row.type === type).reduce((sum,row) => sum + Number(row.amount),0)*1000)/1000
  const categories = new Map()
  for (const row of current.filter(row => row.type === 'expense')) {
    const key = row.category_id || 0
    const value = categories.get(key) || {id:key,name:row.category_name || 'Uncategorized',amount:0}
    value.amount += Number(row.amount); categories.set(key,value)
  }
  return {start,end:today,income:total(current,'income'),expense:total(current,'expense'),previous_expense:total(previous,'expense'),count:current.filter(row => row.type !== 'transfer').length,top_category:[...categories.values()].sort((a,b) => b.amount-a.amount)[0] || null}
}
