import { useEffect, useMemo, useRef, useState } from 'react'
import { Bell, CalendarClock, Check, ChevronDown, ListFilter, Pencil, Plus, Trash2 } from 'lucide-react'
import { api, jsonBody, money } from '../lib/api'
import { dateInput, saveDate, showTime } from '../lib/time'
import DateTimeField from '../components/DateTimeField'
import ReportingMonthField from '../components/ReportingMonthField'
import { useApp } from '../App'
import '../upcoming.css'

const statuses = [['upcoming', 'Upcoming'], ['all', 'All records'], ['planned', 'Planned'], ['scheduled', 'Scheduled'], ['failed', 'Needs attention'], ['posted', 'Recorded']]
const empty = () => ({ type: 'expense', amount: '', description: '', notes: '', date: dateInput(new Date(Date.now() + 86400000)), reporting_month: '', wallet_id: '', transfer_wallet_id: '', category_id: '', status: 'planned', reminder_enabled: true })
const reportingMonthLabel = month => new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric' }).format(new Date(`${month}-01T12:00:00`))

function StatusFilter({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const root = useRef(null)
  useEffect(() => {
    if (!open) return
    const close = event => { if (!root.current?.contains(event.target)) setOpen(false) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])
  const label = statuses.find(([key]) => key === value)?.[1]
  return <div className="upcoming-filter" ref={root} onKeyDown={event => {
    if (event.key === 'Escape') { setOpen(false); root.current?.querySelector('.upcoming-filter-button')?.focus() }
    if (open && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      const items = [...root.current.querySelectorAll('[role="menuitemradio"]')]
      const index = items.indexOf(document.activeElement)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : event.key === 'ArrowDown' ? (index + 1) % items.length : (index + items.length - 1) % items.length
      items[next]?.focus()
    }
  }}>
    <button type="button" className="upcoming-filter-button" aria-label={`Plan status: ${label}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(current => !current)}><ListFilter size={17}/><span>{label}</span><ChevronDown size={16}/></button>
    {open && <div className="upcoming-filter-menu" role="menu" aria-label="Plan status">{statuses.map(([key, name]) => <button key={key} type="button" role="menuitemradio" aria-checked={value === key} onClick={() => { onChange(key); setOpen(false); root.current?.querySelector('.upcoming-filter-button')?.focus() }}><span>{name}</span>{value === key && <Check size={16}/>}</button>)}</div>}
  </div>
}

export default function Upcoming() {
  const { user, settings, notify, confirm } = useApp()
  const [rows, setRows] = useState([])
  const [wallets, setWallets] = useState([])
  const [categories, setCategories] = useState([])
  const [scope, setScope] = useState('all')
  const [filter, setFilter] = useState('upcoming')
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const editor = useRef(null)

  const load = async () => {
    const [plans, owned, shared, ownCategories] = await Promise.all([api('/api/planned-transactions'), api('/api/wallets'), api('/api/shared/wallets'), api('/api/categories')])
    setRows(plans)
    const own = owned.filter(w => !w.archived && !w.is_shared).map(w => ({ id: w.id, name: w.name, owner_id: user.id, shared: false, editable: true }))
    const others = shared.filter(w => !w.archived).map(w => ({ id: w.wallet_id, name: w.name, owner_id: w.owner_id, shared: true, editable: w.can_add }))
    setWallets([...own, ...others.filter(w => !own.some(item => item.id === w.id))])
    setCategories(ownCategories)
    setLoading(false)
  }
  useEffect(() => { let active = true; load().catch(err => { if (active) { setError(err.message); setLoading(false) } }); return () => { active = false } }, [user.id])

  const start = row => {
    setError('')
    if (row) setDraft({ ...row, status: row.status === 'failed' ? 'planned' : row.status, amount: String(row.amount), date: dateInput(row.date), reporting_month: row.reporting_month || String(row.date || '').slice(0, 7), wallet_id: String(row.wallet_id), transfer_wallet_id: row.transfer_wallet_id ? String(row.transfer_wallet_id) : '', category_id: row.category_id ? String(row.category_id) : '' })
    else setDraft({ ...empty(), wallet_id: String(wallets.find(w => w.editable)?.id || '') })
    window.requestAnimationFrame?.(() => editor.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }))
  }
  const change = (key, value) => setDraft(current => ({ ...current, [key]: value, ...(key === 'wallet_id' || key === 'type' ? { category_id: '', transfer_wallet_id: '' } : {}), ...(key === 'type' && value !== 'expense' ? { reporting_month: '' } : {}) }))
  const wallet = wallets.find(w => String(w.id) === String(draft?.wallet_id))
  useEffect(() => {
    if (!draft?.wallet_id || wallet?.owner_id === user.id) return
    let active = true
    api(`/api/shared/wallets/${draft.wallet_id}/categories`).then(items => {
      if (active) setCategories(current => [...current.filter(c => c.wallet_id !== Number(draft.wallet_id)), ...items.map(c => ({ ...c, wallet_id: Number(draft.wallet_id) }))])
    }).catch(() => {})
    return () => { active = false }
  }, [draft?.wallet_id, wallet?.owner_id, user.id])
  const choices = categories.filter(c => c.kind === draft?.type && (wallet?.owner_id === user.id || c.wallet_id === Number(draft?.wallet_id)))
  const displayed = useMemo(() => rows.filter(row => (scope === 'all' || (scope === 'shared') === row.shared) && (filter === 'all' || (filter === 'upcoming' ? ['planned', 'scheduled', 'failed'].includes(row.status) : row.status === filter))), [rows, scope, filter])
  const total = displayed.filter(row => row.status !== 'posted').reduce((value, row) => value + (row.type === 'income' ? row.amount : row.type === 'expense' ? -row.amount : 0), 0)
  const categoryLabel = row => row.type === 'transfer' ? wallets.find(item => item.id === row.transfer_wallet_id)?.name || 'Destination wallet' : row.category_name || 'Uncategorized'

  const save = async event => {
    event.preventDefault()
    if (!draft || busy) return
    if (!draft.description.trim() || !Number.isFinite(Number(draft.amount)) || Number(draft.amount) <= 0 || !draft.wallet_id || !draft.date) { setError('Enter a description, positive amount, wallet, and date.'); return }
    if (draft.type === 'transfer' && (!draft.transfer_wallet_id || draft.transfer_wallet_id === draft.wallet_id)) { setError('Choose a different destination wallet.'); return }
    if (draft.status === 'scheduled' && new Date(saveDate(draft.date)).getTime() <= Date.now()) { setError('Choose a future date and time for automatic recording.'); return }
    setBusy(true); setError('')
    try {
      await api(draft.id ? `/api/planned-transactions/${draft.id}` : '/api/planned-transactions', { method: draft.id ? 'PUT' : 'POST', ...jsonBody({ status: draft.status === 'failed' ? 'planned' : draft.status, reminder_enabled: draft.reminder_enabled, transaction: { type: draft.type, amount: Number(draft.amount), description: draft.description.trim(), notes: draft.notes || '', date: saveDate(draft.date), reporting_month: draft.type === 'transfer' ? null : draft.reporting_month || null, wallet_id: Number(draft.wallet_id), transfer_wallet_id: draft.type === 'transfer' ? Number(draft.transfer_wallet_id) : null, category_id: draft.type === 'transfer' || !draft.category_id ? null : Number(draft.category_id), recurring_frequency: 'none', recurring_until: null } }) })
      setDraft(null); await load(); notify('Upcoming entry saved')
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  const remove = async row => {
    if (!await confirm(`Delete "${row.description}" from upcoming entries?`)) return
    try { await api(`/api/planned-transactions/${row.id}`, { method: 'DELETE' }); await load(); notify('Upcoming entry deleted') } catch (err) { notify(err.message, 'error') }
  }

  return <section className="upcoming-page">
    <header className="upcoming-toolbar"><div><h3>Upcoming records</h3><p className="muted">Plan ahead without changing your balance.</p></div><button type="button" className="button primary" data-tour="new-plan" onClick={() => start(null)}><Plus size={17}/>Add plan</button></header>
    <div className="upcoming-controls">
      <div className="segment-control three" role="group" aria-label="Wallet context">{[['all', 'All'], ['personal', 'Personal'], ['shared', 'Shared']].map(([value, label]) => <button key={value} type="button" className={scope === value ? 'active' : ''} aria-pressed={scope === value} onClick={() => setScope(value)}>{label}</button>)}</div>
      <StatusFilter value={filter} onChange={setFilter}/>
      <span className="upcoming-total">Net planned: {money(total, settings.currency)}</span>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {draft && <form ref={editor} className="upcoming-editor stack gap-12" onSubmit={save}>
      <div className="upcoming-editor-heading"><h4>{draft.id ? 'Edit entry' : 'New entry'}</h4><span className="muted">{draft.status === 'scheduled' ? 'Records automatically after the due time' : 'Plan only'}</span></div>
      <DateTimeField value={draft.date} onChange={value => change('date', value)} disabled={busy}/>
      <div className="form-grid two">
        <label className="field"><span>Type</span><select value={draft.type} onChange={event => change('type', event.target.value)}><option value="expense">Expense</option><option value="income">Income</option><option value="transfer">Transfer</option></select></label>
        <label className="field"><span>Amount ({settings.currency})</span><input required type="number" min="0.001" step="0.001" value={draft.amount} onChange={event => change('amount', event.target.value)}/></label>
      </div>
      {draft.type !== 'transfer' && <ReportingMonthField value={draft.reporting_month} type={draft.type} disabled={busy} onChange={value => change('reporting_month', value)}/>}
      <label className="field"><span>Description</span><input required maxLength="160" placeholder="What is this for?" value={draft.description} onChange={event => change('description', event.target.value)}/></label>
      <div className="form-grid two">
        <label className="field"><span>Wallet</span><select required value={draft.wallet_id} onChange={event => change('wallet_id', event.target.value)}><option value="">Choose wallet</option>{wallets.filter(w => w.editable).map(w => <option key={w.id} value={w.id}>{w.name}{w.shared ? ' · Shared' : ''}</option>)}</select></label>
        <label className="field"><span>{draft.type === 'transfer' ? 'Destination' : 'Category'}</span>{draft.type === 'transfer' ? <select required value={draft.transfer_wallet_id} onChange={event => change('transfer_wallet_id', event.target.value)}><option value="">Choose destination</option>{wallets.filter(w => w.editable && w.owner_id === wallet?.owner_id && String(w.id) !== String(wallet?.id)).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select> : <select value={draft.category_id} onChange={event => change('category_id', event.target.value)}><option value="">Uncategorized</option>{choices.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}</label>
      </div>
      <label className="field"><span>Recording</span><select value={draft.status} onChange={event => change('status', event.target.value)}><option value="planned">Plan only</option><option value="scheduled">Auto record</option></select></label>
      <label className="upcoming-reminder"><input type="checkbox" checked={draft.reminder_enabled} onChange={event => change('reminder_enabled', event.target.checked)}/><Bell size={19}/><span>Remind me</span></label>
      <div className="modal-actions"><button type="button" className="button ghost" onClick={() => { setDraft(null); setError('') }}>Cancel</button><button className="button primary" disabled={busy}>{busy ? 'Saving...' : 'Save entry'}</button></div>
    </form>}
    <div className="upcoming-records" aria-live="polite">
      {loading ? <p className="upcoming-empty">Loading upcoming records...</p> : displayed.length === 0 ? <p className="upcoming-empty">No entries in this view.</p> : displayed.map(row => <article className="upcoming-record" key={row.id}>
        <div className="upcoming-record-main">
          <div className="upcoming-record-title"><strong>{row.description}</strong><span className={`upcoming-status ${row.status}`}>{row.status === 'posted' ? 'Recorded' : row.status === 'failed' ? 'Needs attention' : row.status}</span></div>
          <div className="upcoming-record-details"><span><CalendarClock size={15}/>{showTime(row.date)}</span><span className="upcoming-type">{row.type}</span>{row.reporting_month && row.reporting_month !== String(row.date || '').slice(0, 7) && <span>For {reportingMonthLabel(row.reporting_month)}</span>}<span>{row.wallet_name}{row.shared ? ` · Shared with ${row.owner_name}` : ''}</span><span>{categoryLabel(row)}</span>{row.reminder_enabled && row.status !== 'posted' && <span><Bell size={15}/>Reminder on</span>}</div>
          {row.error && <p className="upcoming-error" role="status">{row.error}</p>}
        </div>
        <div className="upcoming-record-end"><strong className={`upcoming-amount ${row.type}`}>{row.type === 'expense' ? '-' : row.type === 'income' ? '+' : ''}{money(row.amount, settings.currency)}</strong>{row.can_edit && row.status !== 'posted' && <div className="button-row"><button type="button" className="icon-button" title="Edit entry" aria-label={`Edit ${row.description}`} onClick={() => start(row)}><Pencil size={17}/></button><button type="button" className="icon-button" title="Delete entry" aria-label={`Delete ${row.description}`} onClick={() => remove(row)}><Trash2 size={17}/></button></div>}</div>
      </article>)}
    </div>
    <p className="muted upcoming-footnote"><CalendarClock size={15}/> Auto record runs on your next app visit after the due time, or during daily maintenance. Planned rows remain estimates until recorded.</p>
  </section>
}
