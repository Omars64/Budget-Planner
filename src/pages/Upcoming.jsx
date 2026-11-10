import AppSelect from '../components/AppSelect'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Bell, CalendarClock, CalendarPlus, Pencil, Trash2 } from 'lucide-react'
import { api, jsonBody, money } from '../lib/api'
import { syncPlannedNotifications } from '../lib/plannedNotifications'
import { categoryChoices } from '../lib/categoryChoices'
import { dateInput, saveDate, showTime } from '../lib/time'
import DateTimeField from '../components/DateTimeField'
import ReportingMonthField from '../components/ReportingMonthField'
import Modal from '../components/Modal'
import PageActions from '../components/PageActions'
import { useApp } from '../App'
import '../upcoming.css'
import '../everyday-planning.css'

const tabs = [['upcoming', 'Coming up'], ['posted', 'Recorded'], ['all', 'All entries']]
const planLabel = row => row.status === 'posted' ? 'Recorded' : row.status === 'failed' ? 'Needs attention' : row.status === 'scheduled' ? 'Records automatically' : row.reminder_enabled && row.type === 'expense' ? 'Reminder only' : 'Plan only'
const empty = () => ({ type: 'expense', amount: '', description: '', notes: '', date: dateInput(new Date(Date.now() + 86400000)), reporting_month: '', wallet_id: '', transfer_wallet_id: '', category_id: '', status: 'planned', reminder_enabled: true })
const reportingMonthLabel = month => new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric' }).format(new Date(`${month}-01T12:00:00`))

export default function Upcoming() {
  const { user, settings, notify, confirm, activeSpace, canAdd = true } = useApp()
  const [rows, setRows] = useState([])
  const [wallets, setWallets] = useState([])
  const [categories, setCategories] = useState([])
  const [scope, setScope] = useState('all')
  const [filter, setFilter] = useState('upcoming')
  const [status, setStatus] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [loading, setLoading] = useState(true)
  const formId = useId()
  const baseline = useRef('')

  const load = async () => {
    const [plans, owned, ownCategories] = await Promise.all([api('/api/planned-transactions'), api('/api/wallets'), api('/api/categories')])
    setRows(plans)
    const own = owned.filter(w => !w.archived && (activeSpace || !w.is_shared)).map(w => ({ id: w.id, name: w.name, owner_id: user.id, shared: Boolean(activeSpace), editable: canAdd }))
    setWallets(own)
    setCategories(ownCategories)
    setLoading(false)
  }
  useEffect(() => { let active = true; load().catch(err => { if (active) { setError(err.message); setLoading(false) } }); return () => { active = false } }, [user.id])

  const start = row => {
    setSelectedId(null)
    setError('')
    setConflict(false)
    const next = row ? { ...row, status: row.status === 'failed' ? 'planned' : row.status, amount: String(row.amount), date: dateInput(row.date), reporting_month: row.reporting_month || String(row.date || '').slice(0, 7), wallet_id: String(row.wallet_id), transfer_wallet_id: row.transfer_wallet_id ? String(row.transfer_wallet_id) : '', category_id: row.category_id ? String(row.category_id) : '' } : { ...empty(), wallet_id: String(wallets.find(w => w.editable)?.id || '') }
    baseline.current = JSON.stringify(next)
    setDraft(next)
  }
  const closeEditor = () => { if (!busy) { setDraft(null); setError(''); setConflict(false) } }
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
  const choices = categoryChoices(categories.filter(c => c.kind === draft?.type && (wallet?.owner_id === user.id || c.wallet_id === Number(draft?.wallet_id))), activeSpace?.id, draft?.category_id)
  const selected = rows.find(row => row.id === selectedId)
  const displayed = useMemo(() => rows.filter(row =>
    (scope === 'all' || (scope === 'shared') === row.shared) &&
    (filter === 'all' || (filter === 'posted') === (row.status === 'posted')) &&
    (!status || row.status === status)
  ).sort((a, b) => new Date(a.date) - new Date(b.date)), [rows, scope, filter, status])
  const total = displayed.filter(row => row.status !== 'posted').reduce((value, row) => value + (row.type === 'income' ? row.amount : row.type === 'expense' ? -row.amount : 0), 0)
  const amountLabel = row => (row.type === 'expense' ? '−' : row.type === 'income' ? '+' : '') + money(row.amount, settings.currency)
  const categoryLabel = row => row.type === 'transfer' ? wallets.find(item => item.id === row.transfer_wallet_id)?.name || 'Destination wallet' : row.category_name || 'Uncategorized'

  const save = async event => {
    event.preventDefault()
    if (!draft || busy) return
    if (!draft.description.trim() || !Number.isFinite(Number(draft.amount)) || Number(draft.amount) <= 0 || !draft.wallet_id || !draft.date) { setError('Enter a description, positive amount, wallet, and date.'); return }
    if (draft.type === 'transfer' && (!draft.transfer_wallet_id || draft.transfer_wallet_id === draft.wallet_id)) { setError('Choose a different destination wallet.'); return }
    if (draft.status === 'scheduled' && new Date(saveDate(draft.date)).getTime() <= Date.now()) { setError('Choose a future date and time for automatic recording.'); return }
    setBusy(true); setError('')
    try {
      await api(draft.id ? `/api/planned-transactions/${draft.id}` : '/api/planned-transactions', { method: draft.id ? 'PUT' : 'POST', ...jsonBody({ ...(draft.id ? { revision: draft.revision } : {}), status: draft.status === 'failed' ? 'planned' : draft.status, reminder_enabled: draft.reminder_enabled, transaction: { type: draft.type, amount: Number(draft.amount), description: draft.description.trim(), notes: draft.notes || '', date: saveDate(draft.date), reporting_month: draft.type === 'transfer' ? null : draft.reporting_month || null, wallet_id: Number(draft.wallet_id), transfer_wallet_id: draft.type === 'transfer' ? Number(draft.transfer_wallet_id) : null, category_id: draft.type === 'transfer' || !draft.category_id ? null : Number(draft.category_id), recurring_frequency: 'none', recurring_until: null } }) })
      setDraft(null); await load(); void syncPlannedNotifications(user.id).catch(() => {}); notify('Upcoming entry saved')
    } catch (err) { setError(err.message); setConflict(err.status === 409 && Boolean(draft.id)) } finally { setBusy(false) }
  }
  const reloadConflict = async () => {
    if (!draft?.id || !await confirm('Reload the latest entry? Your unsaved edits in this form will be replaced.')) return
    setBusy(true)
    try {
      const latest = await api('/api/planned-transactions')
      setRows(latest)
      const row = latest.find(item => item.id === draft.id)
      if (row && row.can_edit && row.status !== 'posted') start(row)
      else { setDraft(null); setConflict(false); setError('This entry was recorded, removed, or your access changed. Review the latest list.') }
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  const remove = async row => {
    if (!await confirm(`Delete "${row.description}" from upcoming entries?`)) return
    try { await api(`/api/planned-transactions/${row.id}`, { method: 'DELETE', ...(row.revision ? { headers: { 'If-Match': row.revision } } : {}) }); setSelectedId(null); await load(); void syncPlannedNotifications(user.id).catch(() => {}); notify('Upcoming entry deleted') } catch (err) { notify(err.message, 'error') }
  }

  return <section className="upcoming-page everyday-page">
    <PageActions><button type="button" className="button primary palette-header-action" data-tour="new-plan" disabled={!canAdd} onClick={() => start(null)}><CalendarPlus size={17}/>Schedule an entry</button></PageActions>
    <div className="poc-pills" role="group" aria-label="Upcoming entries">{tabs.map(([key,label]) => <button type="button" key={key} aria-pressed={filter === key} onClick={() => { setFilter(key); setStatus('') }}>{label}</button>)}</div>
    {error && !draft && <p className="form-error" role="alert">{error}</p>}
    <Modal layerClass="everyday-page" open={Boolean(draft)} onClose={closeEditor} title={draft?.id ? 'Edit upcoming entry' : 'Add upcoming entry'} subtitle="Plan ahead without changing your balance." protectChanges isDirty={Boolean(draft && JSON.stringify(draft) !== baseline.current)} footer={close => <div className="modal-actions"><button type="button" className="button ghost" disabled={busy} onClick={close}>Cancel</button><button type="submit" form={formId} className="button primary" disabled={busy || conflict}>{busy ? 'Saving...' : 'Save entry'}</button></div>}>
    {draft && <form id={formId} className="upcoming-editor stack gap-18 transaction-form" onSubmit={save}>
      <fieldset className="transaction-fields stack gap-18" disabled={busy}>
      <DateTimeField value={draft.date} onChange={value => change('date', value)} disabled={busy}/>
      <div className="form-grid two">
        <label className="field"><span>Type</span><AppSelect value={draft.type} onChange={event => change('type', event.target.value)}><option value="expense">Expense</option><option value="income">Income</option><option value="transfer">Transfer</option></AppSelect></label>
        <label className="field"><span>Amount ({settings.currency})</span><input required type="number" min="0.001" step="0.001" value={draft.amount} onChange={event => change('amount', event.target.value)}/></label>
      </div>
      {draft.type !== 'transfer' && <ReportingMonthField value={draft.reporting_month} type={draft.type} disabled={busy} onChange={value => change('reporting_month', value)}/>}
      <label className="field"><span>Description</span><input required maxLength="160" placeholder="What is this for?" value={draft.description} onChange={event => change('description', event.target.value)}/></label>
      <div className="form-grid two">
        <label className="field"><span>Wallet</span><AppSelect required value={draft.wallet_id} onChange={event => change('wallet_id', event.target.value)}><option value="">Choose wallet</option>{wallets.filter(w => w.editable).map(w => <option key={w.id} value={w.id}>{w.name}{w.shared ? ' · Shared' : ''}</option>)}</AppSelect></label>
        <label className="field"><span>{draft.type === 'transfer' ? 'Destination' : 'Category'}</span>{draft.type === 'transfer' ? <AppSelect required value={draft.transfer_wallet_id} onChange={event => change('transfer_wallet_id', event.target.value)}><option value="">Choose destination</option>{wallets.filter(w => w.editable && w.owner_id === wallet?.owner_id && String(w.id) !== String(wallet?.id)).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</AppSelect> : <AppSelect value={draft.category_id} onChange={event => change('category_id', event.target.value)}><option value="">Uncategorized</option>{choices.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</AppSelect>}</label>
      </div>
      <label className="field"><span>Recording</span><AppSelect aria-describedby={`${formId}-recording-help`} value={draft.status} onChange={event => change('status', event.target.value)}><option value="planned">Plan only / remind me</option><option value="scheduled">Record automatically</option></AppSelect></label>
      <p id={`${formId}-recording-help`} className="muted everyday-help">{draft.status === 'scheduled' ? 'Records at the next automatic server check after the due time, unless processing is paused. No bank payment is made.' : 'Stays a plan after the due time. Add the actual transaction yourself when it happens; this plan will not record automatically.'}</p>
      <label className="upcoming-reminder"><input type="checkbox" checked={draft.reminder_enabled} onChange={event => change('reminder_enabled', event.target.checked)}/><Bell size={19}/><span>Remind me</span></label>
      <p className="muted everyday-help">Reminders apply to expense entries only and depend on notification settings and permissions. Manage timing and delivery in Settings.</p>
      <label className="field"><span>Notes (optional)</span><textarea value={draft.notes || ''} onChange={event => change('notes', event.target.value)}/></label>
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
      {conflict && <button type="button" className="button ghost" disabled={busy} onClick={() => void reloadConflict()}>Reload latest entry</button>}
    </form>}
    </Modal>
    <div className="poc-list" aria-live="polite">
      {loading ? <p className="muted">Loading upcoming records…</p> : displayed.length === 0 ? <p className="muted">No entries in this view.</p> : displayed.map(row => <button type="button" className="poc-line plan-row" key={row.id} onClick={() => setSelectedId(row.id)}>
        <span className="poc-marker"><CalendarClock size={18} aria-hidden="true"/></span>
        <span><strong>{row.description}</strong><small>{showTime(row.date)} · {row.wallet_name}</small><span className={`upcoming-status ${row.status}`}>{planLabel(row)}</span></span>
        <strong className={`upcoming-amount ${row.type}`}>{amountLabel(row)}</strong>
      </button>)}
    </div>
    <details className="poc-disclosure"><summary>More filters &amp; details</summary>
      <div className="form-grid two">
        <label className="field"><span>Wallet context</span><AppSelect value={scope} onChange={event => setScope(event.target.value)}><option value="all">All wallets</option><option value="personal">Personal</option><option value="shared">Shared</option></AppSelect></label>
        {filter !== 'posted' && <label className="field"><span>Plan status</span><AppSelect value={status} onChange={event => setStatus(event.target.value)}><option value="">Any status</option><option value="planned">Manual / reminder only</option><option value="scheduled">Automatic</option><option value="failed">Needs attention</option></AppSelect></label>}
      </div>
      <p><strong>Net planned</strong> {money(total, settings.currency)}</p>
      <p className="muted">Automatic entries record after the due time when processing runs. Plans stay unrecorded until you add the transaction yourself.</p>
    </details>
    <Modal open={Boolean(selected)} onClose={() => setSelectedId(null)} title={selected?.description || 'Upcoming entry'}>
      {selected && <div className="stack gap-12">
        <strong className={`upcoming-amount ${selected.type}`}>{amountLabel(selected)}</strong>
        <span className={`upcoming-status ${selected.status}`}>{planLabel(selected)}</span>
        <dl className="transaction-details"><div><dt>Date</dt><dd>{showTime(selected.date)}</dd></div><div><dt>Wallet</dt><dd>{selected.wallet_name}{selected.shared ? ` · Shared with ${selected.owner_name}` : ''}</dd></div><div><dt>{selected.type === 'transfer' ? 'Destination' : 'Category'}</dt><dd>{categoryLabel(selected)}</dd></div>
          {selected.reporting_month && <div><dt>For month</dt><dd>{reportingMonthLabel(selected.reporting_month)}</dd></div>}</dl>
        {selected.reminder_enabled && selected.type === 'expense' && ['planned', 'scheduled'].includes(selected.status) && <p><Bell size={15}/> Reminder on</p>}
        {selected.error && <p className="form-error" role="status">{selected.error}</p>}
        {selected.notes && <p className="transaction-note">{selected.notes}</p>}
        {selected.can_edit && selected.status !== 'posted' && <div className="modal-actions"><button type="button" className="button ghost" onClick={() => remove(selected)}><Trash2 size={17}/>Delete {selected.description}</button><button type="button" className="button primary" onClick={() => start(selected)}><Pencil size={17}/>Edit {selected.description}</button></div>}
      </div>}
    </Modal>
  </section>
}
