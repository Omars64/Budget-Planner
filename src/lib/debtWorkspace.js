import { dateKey } from './time'
import { currencyDigits } from './currency'

export const debtPath = '/api/debt-workspace'
export const debtChanged = 'budgetly:debt-workspace'
export const debtViews = { debts:'Debt Management', schedule:'Repayment schedule', history:'Payment history', more:'More', reminders:'Debt reminders', payoff:'Debt-free calculator', directory:'Debt spaces' }
export const debtRoles = { owner:'Owner', edit:'Manager', view:'Viewer' }
const debtRoot = '/debt-management'
export const debtUrl = (id, view = 'debts') => debtRoot + (id ? `/spaces/${id}` : '') + (view === 'debts' ? '' : `/${view}`)
export const debtApi = id => id ? `${debtPath}/spaces/${id}` : debtPath
export function debtRoute(path) {
  const match = /^\/debt-management(?:\/spaces\/([0-9a-f-]{36}))?(?:\/([^/]+))?\/?$/i.exec(path)
  if (!match) return null
  const view = match[2] === 'access' ? 'directory' : match[2] || 'debts'
  return Object.hasOwn(debtViews, view) ? {id:match[1] || null, view} : null
}
export const reminderLeads = [[null,'Off'], [0,'On the due date'], [1,'1 day before'], [3,'3 days before'], [7,'7 days before'], [14,'14 days before']]
export const debtKinds = { loan:'Loan', borrowed:'Money borrowed', lent:'Money lent' }
export const incoming = record => record.kind === 'lent'
export const sum = (items, value) => items.reduce((total, item) => total + value(item), 0)
export const paid = item => sum(item.payments, payment => payment.amount)
export const left = item => item.amount - paid(item)
export const remaining = record => sum(record.items, left)
export const fromDate = day => new Date(day + 'T00:00:00Z')
export const dayLabel = day => dayFormat.format(fromDate(day))
export const monthLabel = (month, short = false) => (short ? shortMonthFormat : monthFormat).format(fromDate(month + '-01'))
export const shiftDay = (day, offset) => new Date(fromDate(day).valueOf() + offset * 86400000).toISOString().slice(0, 10)
const dayFormat = new Intl.DateTimeFormat('en-GB', { day:'numeric', month:'short', year:'numeric', timeZone:'UTC' })
const monthFormat = new Intl.DateTimeFormat('en-GB', { month:'long', year:'numeric', timeZone:'UTC' })
const shortMonthFormat = new Intl.DateTimeFormat('en-GB', { month:'short', year:'numeric', timeZone:'UTC' })
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
export function makeSchedule({ opening, monthly, apr, month, due }, currency, createIds = true) {
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
    items.push({ ...(createIds ? {id:crypto.randomUUID()} : {}), month:assignedMonth, due:`${next}-${String(day).padStart(2,'0')}`, amount, payments:[] })
    principal -= amount - interest
  }
  if (principal > 0) throw new Error('Choose a monthly payment that covers the balance within 120 instalments.')
  return items
}
export function preserveDebtPayments(previous, schedule) {
  const byMonth = new Map(schedule.map(item => [item.month,item]))
  for (const old of previous) {
    const next = byMonth.get(old.month)
    if (old.payments.length && (!next || next.amount < paid(old))) {
      throw new Error(`Keep ${monthLabel(old.month)} in the schedule with enough to cover its recorded payments.`)
    }
    if (next) {
      next.id = old.id
      next.payments = old.payments
    }
  }
  return schedule
}
export const allItems = records => records.flatMap(record => record.items.map(item => ({ record, item })))
export const openItems = records => allItems(records).filter(({item}) => left(item) > 0)
  .sort((a,b) => a.item.due.localeCompare(b.item.due))
export function paymentStatus(record,item,today) {
  if (item.covered_by) return 'Covered by extra payment'
  if (left(item) === 0) return incoming(record) ? 'Received' : 'Paid'
  const partial = item.payments.length ? (incoming(record) ? 'Part received' : 'Part paid') : ''
  return item.due < today ? (partial ? `${partial} · Overdue` : 'Overdue') : partial || 'Due'
}
export function extraPaymentChange(record, item, amount, currency) {
  const extra = amount - left(item)
  if (!(extra > 0)) return null
  const later = record.items.filter(term => term.month > item.month && left(term) > 0)
    .sort((a,b) => a.month.localeCompare(b.month))
  const balance = sum(later,left)
  if (extra > balance) return { limit:left(item)+balance, hasLater:later.length > 0 }
  const unit = 10 ** (3 - Math.min(currencyDigits(currency), 3)), units = (balance - extra)/unit
  if (!Number.isInteger(units)) return { precisionError:true }
  const each = Math.floor(units/later.length), remainder = units % later.length
    const schedule = later.map((term, index) => ({month:term.month, amount:(each + Number(index < remainder))*unit})).filter(term=>term.amount>0)
    return { extra, schedule }
}
export function payoffMonth(records,extra,today = dateKey()) {
  const start = today.slice(0,7)
  const outgoing = openItems(records.filter(record => !incoming(record)))
  if (!outgoing.length) return null
  const byMonth = new Map()
  let balance = sum(outgoing, ({item}) => left(item))
  for (const {item} of outgoing) {
    const month = item.due.slice(0,7) < start ? start : item.due.slice(0,7)
    byMonth.set(month, (byMonth.get(month) || 0) + left(item))
  }
  const final = [...byMonth.keys()].at(-1)
  if (!extra) return final
  for (let month = start; month <= final; month = shiftMonth(month,1)) {
    balance -= (byMonth.get(month) || 0) + extra
    if (balance <= 0) return month
  }
  return final
}
