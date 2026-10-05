import { dateInput } from './time'
import { weeklySummary } from './weeklySummary'

export const GUEST_KEY = 'budgetly_guest_workspace_v1'
export const GUEST_IMPORT_KEY = 'budgetly_guest_import_pending_v1'
const ACTIVE_KEY = 'budgetly_guest_active'
let active = false
export const guestActive = () => active
export const guestRemembered = () => localStorage.getItem(ACTIVE_KEY) === 'true'
export const guestUser = { id: 'guest', username: 'Guest', role: 'guest', email: '', active: true }
export const guestRoutes = new Set(['/', '/transactions', '/wallets', '/budgets', '/analytics', '/settings'])
export function setGuestActive(value) {
  localStorage.setItem(ACTIVE_KEY, String(Boolean(value)))
  active = Boolean(value)
}
export function requestGuestSignIn(feature = 'this feature') {
  window.dispatchEvent(new CustomEvent('budgetly:guest-signin', { detail: feature }))
}
const fail = (message, status = 422) => { throw Object.assign(new Error(message), { status }) }
const round = value => Math.round((value + Number.EPSILON) * 1000) / 1000
const sum = rows => round(rows.reduce((total, row) => total + row.amount, 0))
const monthNow = () => dateInput().slice(0, 7)
function emptyWorkspace() {
  const names = ['Food & Dining', 'Transport', 'Shopping', 'Home', 'Entertainment', 'Health', 'Bills', 'Travel', 'Salary', 'Freelance', 'Gift', 'Other Income']
  return { schema: 1, id: crypto.randomUUID(), revision: 0, nextId: 20,
    wallets: [{ id: 1, name: 'Main', type: 'cash', initial_balance: 0, color: '#3158aa', icon: 'wallet', card_network: null, archived: false, opening_date: dateInput() }],
    categories: names.map((name, index) => ({ id: index + 2, name, kind: index < 8 ? 'expense' : 'income', color: ['#3158aa', '#267d75', '#75465f', '#596575'][index % 4], icon: 'circle' })),
    transactions: [], budgets: [], settings: { currency: 'KWD', display_name: 'Budgetly', theme: 'system', compact_numbers: false, week_starts_on: 'sunday', wallpaper_style: 'none', wallpaper_enabled: false } }
}
export function readGuest() {
  const raw = localStorage.getItem(GUEST_KEY)
  if (!raw) { const data = emptyWorkspace(); localStorage.setItem(GUEST_KEY, JSON.stringify(data)); return data }
  try {
    const data = JSON.parse(raw)
    if (data.schema !== 1 || !data.id || !['wallets', 'categories', 'transactions', 'budgets'].every(key => Array.isArray(data[key]))) throw new Error()
    return data
  } catch { fail('Guest records could not be read. They have not been deleted. Contact support before clearing app storage.', 500) }
}
export function guestHasRecords() {
  if (!localStorage.getItem(GUEST_KEY)) return false
  const data = readGuest()
  return Boolean(data.transactions.length || data.budgets.length || data.wallets.some(w => w.initial_balance !== 0 || w.name !== 'Main') || data.wallets.length > 1 || sessionStorage.getItem('budgetly_guest_schedule'))
}
export function clearGuest(expected) {
  if (expected) {
    const data = readGuest()
    if (data.id !== expected.id || data.revision !== expected.revision) return false
  }
  if (expected) localStorage.removeItem(GUEST_KEY)
  else {
    const settings = readGuest().settings, fresh = emptyWorkspace()
    fresh.settings = settings
    localStorage.setItem(GUEST_KEY, JSON.stringify(fresh))
  }
  sessionStorage.removeItem('flowbudget_tx_draft_guest')
  localStorage.removeItem('flowbudget_tx_draft_guest')
  sessionStorage.removeItem('budgetly_guest_schedule')
  localStorage.removeItem('budgetly:entry:v1:guest:personal')
  window.dispatchEvent(new Event('budgetly:guest-changed'))
  return true
}
function wallets(data) {
  return data.wallets.map(w => ({ ...w, is_shared: false, balance: round(w.initial_balance + data.transactions.reduce((total, t) => total + (t.wallet_id === w.id ? t.type === 'income' ? t.amount : -t.amount : 0) + (t.type === 'transfer' && t.transfer_wallet_id === w.id ? t.amount : 0), 0)) }))
}
function transactions(data) {
  const regular = data.transactions.map(t => ({ ...t, revision: String(t.revision), wallet_name: data.wallets.find(w => w.id === t.wallet_id)?.name,
    transfer_wallet_name: data.wallets.find(w => w.id === t.transfer_wallet_id)?.name || null, category_name: data.categories.find(c => c.id === t.category_id)?.name || null,
    category_color: data.categories.find(c => c.id === t.category_id)?.color || null, is_opening_balance: false }))
  const opening = data.wallets.filter(w => w.initial_balance !== 0).map(w => ({ id: -w.id, wallet_id: w.id, wallet_name: w.name, type: w.initial_balance > 0 ? 'income' : 'expense', amount: Math.abs(w.initial_balance), description: 'Opening balance', notes: '', date: w.opening_date, reporting_month: w.opening_date.slice(0, 7), is_opening_balance: true, recurring_frequency: 'none' }))
  return [...regular, ...opening].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
}
function categoryTotals(rows, data) {
  const totals = new Map()
  rows.filter(t => t.type === 'expense' && !t.is_opening_balance).forEach(t => totals.set(t.category_id || 0, (totals.get(t.category_id || 0) || 0) + t.amount))
  return [...totals].map(([id, value]) => ({ id, value: round(value), name: data.categories.find(c => c.id === id)?.name || 'Uncategorized', color: data.categories.find(c => c.id === id)?.color || '#94a3b8' })).sort((a, b) => b.value - a.value)
}
function budgetRows(data, month = monthNow(), overview = false) {
  const now = new Date(dateInput()), currentMonth = monthNow(), day = overview && month !== currentMonth ? new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0) : now
  const end = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
  return data.budgets.map(b => {
    const week = new Date(day); week.setDate(day.getDate() - (data.settings.week_starts_on === 'monday' ? (day.getDay() + 6) % 7 : day.getDay()))
    const weekStart = `${week.getFullYear()}-${String(week.getMonth() + 1).padStart(2, '0')}-${String(week.getDate()).padStart(2, '0')}`
    const start = [b.start_date, b.period === 'yearly' ? `${month.slice(0, 4)}-01-01` : b.period === 'weekly' ? weekStart : `${month}-01`].sort().at(-1)
    const report = b.reporting_month || month
    const rows = data.transactions.filter(t => t.type === 'expense' && (!b.category_id || t.category_id === b.category_id) && (b.period === 'monthly' ? t.reporting_month === report : b.period === 'yearly' ? t.reporting_month >= start.slice(0, 7) && t.reporting_month <= month : t.date.slice(0, 10) >= start && (!overview || t.date.slice(0, 10) <= end)))
    const spent = sum(rows)
    return { ...b, category_name: data.categories.find(c => c.id === b.category_id)?.name || null, spent, remaining: round(Math.max(0, b.limit_amount - spent)), progress: round(spent / b.limit_amount * 100), records_month: b.period === 'monthly' ? report : null, records_from: `${start}T00:00:00`, records_to: `${end}T23:59:59.999999` }
  }).filter(b => !overview || !b.reporting_month || b.reporting_month === month)
}
function filterTransactions(rows, params) {
  const search = (params.get('search') || '').toLowerCase()
  let result = rows.filter(t => (!search || `${t.description} ${t.notes}`.toLowerCase().includes(search)) &&
    (!params.get('tx_type') || params.get('tx_type') === 'all' || t.type === params.get('tx_type')) &&
    (!params.get('wallet_id') || t.wallet_id === Number(params.get('wallet_id')) || t.transfer_wallet_id === Number(params.get('wallet_id'))) &&
    (!params.has('category_id') || (t.category_id || 0) === Number(params.get('category_id'))) &&
    (!params.get('month') || t.reporting_month === params.get('month')) &&
    (!params.get('reporting_from') || t.reporting_month >= params.get('reporting_from')) && (!params.get('reporting_to') || t.reporting_month <= params.get('reporting_to')) &&
    (!params.get('date_from') || t.date >= params.get('date_from')) && (!params.get('date_to') || t.date <= params.get('date_to')) &&
    (params.get('exclude_opening') !== 'true' || !t.is_opening_balance))
  if (params.get('sort') === 'oldest') result = [...result].reverse()
  const offset = Math.max(0, Number(params.get('offset') || 0)), limit = Math.min(1000, Number(params.get('limit') || 200))
  return result.slice(offset, offset + limit)
}
const allowedSettings = new Set(['currency', 'theme', 'compact_numbers', 'week_starts_on', 'font_family', 'text_color', 'accent_color', 'wallpaper_style', 'wallpaper_enabled'])
async function handle(path, options) {
  options.signal?.throwIfAborted()
  const url = new URL(path, 'https://guest.invalid'), route = url.pathname, params = url.searchParams
  const method = options.method || 'GET', data = readGuest()
  if (method !== 'GET' && localStorage.getItem(GUEST_IMPORT_KEY)) fail('A guest import is awaiting confirmation. Sign in to finish it before changing guest records.', 409)
  const body = options.body ? JSON.parse(options.body) : {}
  let result
  if (route === '/api/settings') {
    if (method === 'GET') return data.settings
    if (method === 'PUT') { for (const [key, value] of Object.entries(body)) if (allowedSettings.has(key)) data.settings[key] = value }
    else fail('This operation is not available.')
    result = data.settings
  } else if (route === '/api/account/appearance' && method === 'GET') return { profile_image: '', wallpaper_image: '' }
  else if (route === '/api/categories' && method === 'GET') return data.categories.filter(c => !params.get('kind') || c.kind === params.get('kind'))
  else if (route === '/api/wallets' && method === 'GET') return wallets(data)
  else if (route === '/api/transactions' && method === 'GET') return filterTransactions(transactions(data), params)
  else if (route === '/api/budgets' && method === 'GET') return budgetRows(data)
  else if (route === '/api/dashboard' && method === 'GET') {
    const month = params.get('month') || monthNow(), rows = transactions(data).filter(t => t.reporting_month === month)
    const income = sum(rows.filter(t => t.type === 'income')), opening = sum(rows.filter(t => t.type === 'income' && t.is_opening_balance)), debt = sum(rows.filter(t => t.type === 'expense' && t.is_opening_balance)), expense = sum(rows.filter(t => t.type === 'expense' && !t.is_opening_balance))
    return { month, weekly: weeklySummary(transactions(data)), total_balance: round(wallets(data).filter(w => !w.archived).reduce((v, w) => v + w.balance, 0)), income, expense, net: round(income - expense - debt), earned_income: round(income - opening), opening_funds: opening, opening_debt: debt, wallets: wallets(data).filter(w => !w.archived), shared: { balance: 0, wallet_count: 0 }, cashflow: [], category_spending: categoryTotals(rows, data), recent_transactions: rows.slice(0, 5), budgets: budgetRows(data, month, true) }
  } else if (route === '/api/analytics' && method === 'GET') {
    const now = new Date(dateInput()), all = transactions(data), trend = []
    for (let offset = 5; offset >= 0; offset--) {
      const date = new Date(now.getFullYear(), now.getMonth() - offset, 1), key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`, rows = all.filter(t => t.reporting_month === key)
      trend.push({ month: date.toLocaleDateString('en', { month: 'short' }), month_key: key, income: sum(rows.filter(t => t.type === 'income')), expense: sum(rows.filter(t => t.type === 'expense' && !t.is_opening_balance)) })
    }
    return { trend, categories: categoryTotals(all, data) }
  } else if (/^\/api\/(wallets|transactions|budgets)(\/\d+)?$/.test(route) && ['POST', 'PUT', 'DELETE'].includes(method)) {
    const [, , collection, rawId] = route.split('/'), id = Number(rawId), row = data[collection].find(x => x.id === id)
    if (method !== 'POST' && !row) fail('Record not found.', 404)
    if (method === 'DELETE') {
      if (collection === 'wallets') {
        const linked = data.transactions.some(t => t.wallet_id === id || t.transfer_wallet_id === id)
        if (linked && params.get('delete_transactions') !== 'true') fail('This wallet still has transactions.', 409)
        data.transactions = data.transactions.filter(t => t.wallet_id !== id && t.transfer_wallet_id !== id)
      }
      data[collection] = data[collection].filter(x => x.id !== id); result = null
    } else {
      let next
      if (collection === 'wallets') {
        if ((!row || row.archived) && !body.archived && data.wallets.filter(w => !w.archived).length >= 2) { requestGuestSignIn('more than two wallets'); fail('Sign in to add more wallets.', 403) }
        if (!String(body.name || '').trim() || body.name.length > 100 || !Number.isFinite(body.initial_balance) || Math.abs(body.initial_balance) >= 1e13) fail('Enter a wallet name and valid starting balance.')
        next = { name: body.name.trim(), type: body.type, initial_balance: round(body.initial_balance), color: body.color, icon: body.icon, card_network: ['bank', 'card'].includes(body.type) ? body.card_network || 'visa' : null, archived: Boolean(body.archived), opening_date: row?.opening_date || dateInput() }
      } else if (collection === 'transactions') {
        if ((body.recurring_frequency || 'none') !== 'none') { requestGuestSignIn('repeating transactions'); fail('Sign in to repeat transactions.', 403) }
        const source = data.wallets.find(w => w.id === body.wallet_id), category = data.categories.find(c => c.id === body.category_id)
        if (!['income', 'expense', 'transfer'].includes(body.type) || !Number.isFinite(body.amount) || round(body.amount) <= 0 || body.amount >= 1e13 || !source || source.archived || !body.description?.trim() || body.description.length > 160 || String(body.notes || '').length > 10000 || !Number.isFinite(new Date(body.date).getTime())) fail('Check the transaction fields and wallet.')
        if (body.type === 'income' && !body.reporting_month) fail('Choose the reporting month for this income.')
        if (body.reporting_month && !/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(body.reporting_month)) fail('Choose a valid reporting month.')
        if (body.category_id && (!category || category.kind !== body.type)) fail('Choose a matching category.')
        if (body.type === 'transfer' && (body.wallet_id === body.transfer_wallet_id || !data.wallets.some(w => w.id === body.transfer_wallet_id && !w.archived))) fail('Choose a different destination wallet.')
        if (row && body.revision !== String(row.revision)) fail('This record changed in another tab. Reopen it before editing.', 409)
        const date = dateInput(body.date)
        next = { type: body.type, amount: round(body.amount), description: body.description.trim(), notes: body.notes || '', date, reporting_month: body.type === 'transfer' ? date.slice(0, 7) : body.reporting_month || date.slice(0, 7), wallet_id: body.wallet_id, transfer_wallet_id: body.type === 'transfer' ? body.transfer_wallet_id : null, category_id: body.type === 'transfer' ? null : body.category_id, recurring_frequency: 'none', recurring_until: null, revision: (row?.revision || 0) + 1 }
      } else {
        if (!body.name?.trim() || body.name.length > 120 || !Number.isFinite(body.limit_amount) || round(body.limit_amount) <= 0 || body.limit_amount >= 1e13 || !['weekly', 'monthly', 'yearly'].includes(body.period) || !/^\d{4}-\d{2}-\d{2}$/.test(body.start_date) || !Number.isInteger(body.notify_threshold) || body.notify_threshold < 1 || body.notify_threshold > 100) fail('Check the budget fields.')
        if (body.category_id && !data.categories.some(c => c.id === body.category_id && c.kind === 'expense')) fail('Choose an expense category.')
        if (body.reporting_month && (body.period !== 'monthly' || !/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(body.reporting_month))) fail('Choose a valid budget month.')
        next = { name: body.name.trim(), category_id: body.category_id, limit_amount: round(body.limit_amount), period: body.period, start_date: body.start_date, reporting_month: body.reporting_month || null, notify_threshold: body.notify_threshold }
      }
      if (row) Object.assign(row, next)
      else { next.id = data.nextId++; data[collection].push(next) }
      result = collection === 'transactions' ? transactions(data).find(t => t.id === (row?.id || next.id)) : next
    }
  } else { requestGuestSignIn('this feature'); fail('Sign in to use this feature.', 403) }
  data.revision++
  try { localStorage.setItem(GUEST_KEY, JSON.stringify(data)) } catch { fail('Device storage is full or unavailable. Your previous records are unchanged. Export them before clearing storage.', 507) }
  window.dispatchEvent(new Event('budgetly:guest-changed'))
  return result
}
export function guestApi(path, options = {}) {
  // Serialize local financial writes across tabs where Web Locks are available.
  return navigator.locks ? navigator.locks.request('budgetly-guest-workspace', () => handle(path, options)) : handle(path, options)
}
export function guestImportSnapshot() {
  const data = readGuest()
  return { workspace_id: data.id, revision: data.revision, wallets: data.wallets, categories: data.categories, transactions: data.transactions, budgets: data.budgets, currency: data.settings.currency }
}
export async function beginGuestImport(userId) {
  const freeze = () => {
    const pending = JSON.parse(localStorage.getItem(GUEST_IMPORT_KEY) || 'null')
    if (pending) {
      if (pending.userId !== userId) fail('Sign in to the account where this import was started to finish it. The local copy has been kept.', 409)
      return pending.snapshot
    }
    const snapshot = guestImportSnapshot()
    localStorage.setItem(GUEST_IMPORT_KEY, JSON.stringify({ userId, snapshot }))
    return snapshot
  }
  return navigator.locks ? navigator.locks.request('budgetly-guest-workspace', freeze) : freeze()
}
export function guestCsv() {
  const data = readGuest(), currency = data.settings.currency
  const cell = value => `"${String(value ?? '').replace(/^[=+\-@\t\r]/, "'$&").replaceAll('"', '""')}"`
  return '\ufeff' + [['Date', 'For Month', 'Description', 'Wallet', 'To Wallet', 'Category', 'Money In', 'Money Out', 'Transfer', 'Currency', 'Notes'], ...transactions(data).slice().reverse().map(t => [t.date.replace('T', ' '), t.reporting_month, t.description, t.wallet_name, t.transfer_wallet_name, t.category_name, t.type === 'income' ? t.amount : '', t.type === 'expense' ? t.amount : '', t.type === 'transfer' ? t.amount : '', currency, t.notes])].map(row => row.map(cell).join(',')).join('\r\n')
}
