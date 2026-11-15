import { dateKey } from './time'
import { currencyDigits } from './currency'

export const debtPath = '/api/debt-workspace'
export const debtChanged = 'budgetly:debt-workspace'
export const reminderLeads = [[null,'Off'], [0,'On the due date'], [1,'1 day before'], [3,'3 days before'], [7,'7 days before'], [14,'14 days before']]
export const debtKinds = { loan:'Loan', borrowed:'Money borrowed', lent:'Money lent' }
export const incoming = record => record.kind === 'lent'
export const sum = (items, value) => items.reduce((total, item) => total + value(item), 0)
export const paid = item => sum(item.payments, payment => payment.amount)
export const left = item => item.amount - paid(item)
export const remaining = record => sum(record.items, left)
export const fromDate = day => new Date(day + 'T00:00:00Z')
export const dayLabel = day => dayFormat.format(fromDate(day))
export const monthLabel = month => monthFormat.format(fromDate(month + '-01'))
export const shiftDay = (day, offset) => new Date(fromDate(day).valueOf() + offset * 86400000).toISOString().slice(0, 10)
const dayFormat = new Intl.DateTimeFormat('en-GB', { day:'numeric', month:'short', year:'numeric', timeZone:'UTC' })
const monthFormat = new Intl.DateTimeFormat('en-GB', { month:'long', year:'numeric', timeZone:'UTC' })
export function shiftMonth(value, offset) {
  const [year, month] = value.split('-').map(Number)
  return new Date(Date.UTC(year,month - 1 + offset,1)).toISOString().slice(0,7)
}
export function debtAmount(value, currency) {
  const digits = Math.min(currencyDigits(currency),3)
  const pattern = digits ? new RegExp(`^\\d+(?:[.,]\\d{1,${digits}})?$`) : /^\d+$/
  const content = String(value).trim()
  if (!pattern.test(content)) return NaN
  const minor = Math.round(Number(content.replace(',', '.')) * 1000)
  return Number.isSafeInteger(minor) && minor <= 10**11 ? minor : NaN
}
export function makeSchedule({ opening, monthly, apr, month, due }, currency) {
  let principal = opening
  const items = []
  const originalDay = Number(due.slice(-2))
  const unit = 10 ** (3 - Math.min(currencyDigits(currency), 3))
  for (let index = 0; index < 120 && principal > 0; index++) {
    const interest = Math.round(principal * apr / (1200 * unit)) * unit
    const amount = Math.min(principal + interest, monthly)
    if (amount <= interest) break
    const next = shiftMonth(due, index)
    const [year, nextMonth] = next.split('-').map(Number)
    const day = Math.min(originalDay,new Date(Date.UTC(year,nextMonth,0)).getUTCDate())
    const assignedMonth = shiftMonth(month,index)
    if (assignedMonth > '2199-12' || next > '2199-12') break
    items.push({ id:crypto.randomUUID(), month:assignedMonth, due:`${next}-${String(day).padStart(2,'0')}`, amount, payments:[] })
    principal -= amount - interest
  }
  if (principal > 0) throw new Error('Choose a monthly payment that covers the balance within 120 instalments.')
  return items
}
export const allItems = records => records.flatMap(record => record.items.map(item => ({ record, item })))
export const openItems = records => allItems(records).filter(({item}) => left(item) > 0)
  .sort((a,b) => a.item.due.localeCompare(b.item.due))
export function paymentStatus(record,item,today) {
  if (left(item) === 0) return incoming(record) ? 'Received' : 'Paid'
  const partial = item.payments.length ? (incoming(record) ? 'Part received' : 'Part paid') : ''
  return item.due < today ? (partial ? `${partial} · Overdue` : 'Overdue') : partial || 'Due'
}
export function payoffMonth(records,extra,today = dateKey()) {
  const start = today.slice(0,7)
  const loans = records.filter(record => !incoming(record) && remaining(record) > 0)
    .map(record => ({ ...record, balance:remaining(record) })).sort((a,b) => b.apr-a.apr)
  if (!loans.length) return null
  const first = openItems(loans)[0].item.due.slice(0,7)
  for (let month = first < start ? start : first, count = 0; count < 600; month = shiftMonth(month,1), count++) {
    let available = extra
    for (const loan of loans) {
      if (loan.balance <= 0 || !loan.items.some(item => left(item) > 0 && item.due.slice(0,7) <= month)) continue
      const due = loan.items.filter(item => item.due.startsWith(month) || (month === start && item.due.slice(0,7) < start))
      loan.balance = Math.max(0,loan.balance-sum(due,left))
      const payment = Math.min(available,loan.balance)
      loan.balance -= payment
      available -= payment
    }
    if (loans.every(loan => loan.balance === 0)) return month
  }
  return ''
}
