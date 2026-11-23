import AppSelect from '../components/AppSelect'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Bell, CalendarClock, Pencil, Plus, Trash2 } from 'lucide-react'
import { api, jsonBody, money } from '../lib/api'
import { syncPlannedNotifications } from '../lib/plannedNotifications'
import { categoryChoices } from '../lib/categoryChoices'
import { dateInput, saveDate, showTime } from '../lib/time'
import DateTimeField from '../components/DateTimeField'
import ReportingMonthField from '../components/ReportingMonthField'
import Modal from '../components/Modal'
import PageActions from '../components/PageActions'
import InfoButton from '../components/InfoButton'
import { useApp } from '../App'
import '../upcoming.css'
import '../everyday-planning.css'

const tabs = [['upcoming', 'Coming up'], ['posted', 'Recorded'], ['all', 'All entries']]
const recordingOptions = { planned:'Plan only', scheduled:'Record automatically' }
const planLabel = row => recordingOptions[row.status] ?? (row.status === 'posted' ? 'Recorded' : 'Needs attention')
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
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [recordingHelp, setRecordingHelp] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [loading, setLoading] = useState(true)
  const formId = useId()
  const baseline = useRef('')

  const [choicesError, setChoicesError] = useState('')
  const [choicesRetry, setChoicesRetry] = useState(0)
  const [plansRetry, setPlansRetry] = useState(0)
  const [plansError, setPlansError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    setRows([]); setLoading(true); setPlansError('')
    api('/api/planned-transactions', { signal:controller.signal }).then(plans => {
      if (!controller.signal.aborted) setRows(plans)
    }).catch(err => { if (!controller.signal.aborted) setPlansError(err.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [user.id, activeSpace?.id, plansRetry])
  useEffect(() => {
    const controller = new AbortController()
    const options = { signal:controller.signal }
    setWallets([]); setCategories([]); setChoicesError('')
    Promise.all([api('/api/wallets', options), api('/api/categories', options)]).then(([owned, ownCategories]) => {
      if (controller.signal.aborted) return
      setWallets(owned.filter(w => !w.archived && (activeSpace || !w.is_shared)).map(w => ({
        id:w.id, name:w.name, owner_id:user.id, shared:Boolean(activeSpace), editable:canAdd,
      })))
      setCategories(ownCategories)
    }).catch(err => { if (!controller.signal.aborted) setChoicesError(err.message) })
    return () => controller.abort()
  }, [user.id, activeSpace?.id, canAdd, choicesRetry])

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
    if (!draft?.wallet_id || !wallet || wallet.owner_id === user.id) return
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
      const saved = await api(draft.id ? `/api/planned-transactions/${draft.id}` : '/api/planned-transactions', { method: draft.id ? 'PUT' : 'POST', ...jsonBody({ ...(draft.id ? { revision: draft.revision } : {}), status: draft.status === 'failed' ? 'planned' : draft.status, reminder_enabled: draft.type === 'expense' && draft.reminder_enabled, transaction: { type: draft.type, amount: Number(draft.amount), description: draft.description.trim(), notes: draft.notes || '', date: saveDate(draft.date), reporting_month: draft.type === 'transfer' ? null : draft.reporting_month || null, wallet_id: Number(draft.wallet_id), transfer_wallet_id: draft.type === 'transfer' ? Number(draft.transfer_wallet_id) : null, category_id: draft.type === 'transfer' || !draft.category_id ? null : Number(draft.category_id), recurring_frequency: 'none', recurring_until: null } }) })
      if (saved?.id) setRows(current => [...current.filter(row => row.id !== saved.id), saved])
      setDraft(null); void syncPlannedNotifications(user.id).catch(() => {}); notify('Upcoming entry saved')
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
    try { await api(`/api/planned-transactions/${row.id}`, { method: 'DELETE', ...(row.revision ? { headers: { 'If-Match': row.revision } } : {}) }); setSelectedId(null); setRows(current => current.filter(item => item.id !== row.id)); void syncPlannedNotifications(user.id).catch(() => {}); notify('Upcoming entry deleted') } catch (err) { notify(err.message, 'error') }
  }

  return <section className="upcoming-page everyday-page">
    {canAdd && <PageActions floating><button type="button" className="transaction-fab" data-tour="new-plan" aria-label="Schedule an entry" title="Schedule an entry" onClick={() => start(null)}><Plus size={26} aria-hidden="true"/></button></PageActions>}
    <div className="poc-pills upcoming-controls" role="group" aria-label="Upcoming entries">
      {tabs.map(([key,label]) => <button type="button" key={key} aria-pressed={filter === key} onClick={() => { setFilter(key); setStatus('') }}>{label}</button>)}
      <button type="button" className="upcoming-details-button" aria-haspopup="dialog" onClick={() => setDetailsOpen(true)}>Details{(scope !== 'all' || status) && <span aria-label="Filters active"> •</span>}</button>
    </div>
    {error && !draft && <p className="form-error" role="alert">{error}</p>}
    {plansError && <div className="form-error" role="alert">{plansError} <button type="button" className="button ghost" onClick={() => setPlansRetry(value => value + 1)}>Retry</button></div>}
    <Modal layerClass="everyday-page" open={Boolean(draft)} onClose={closeEditor} title={draft?.id ? 'Edit upcoming entry' : 'Add upcoming entry'} protectChanges isDirty={Boolean(draft && JSON.stringify(draft) !== baseline.current)} footer={close => <div className="modal-actions"><button type="button" className="button ghost" disabled={busy} onClick={close}>Cancel</button><button type="submit" form={formId} className="button primary" disabled={busy || conflict}>{busy ? 'Saving...' : 'Save entry'}</button></div>}>
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
      <div className="field">
        <div className="button-row"><span>Recording</span><InfoButton label="About recording and reminders" onClick={() => setRecordingHelp(true)}/></div>
        <AppSelect aria-label="Recording" value={draft.status} onChange={event => change('status', event.target.value)}>{Object.entries(recordingOptions).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</AppSelect>
        {draft.status === 'scheduled' && <small>Records in Budgetly only.</small>}
      </div>
      {draft.type === 'expense' && <label className="upcoming-reminder"><input type="checkbox" checked={draft.reminder_enabled} onChange={event => change('reminder_enabled', event.target.checked)}/><Bell size={19}/><span>Remind me</span></label>}
      <label className="field"><span>Notes (optional)</span><textarea value={draft.notes || ''} onChange={event => change('notes', event.target.value)}/></label>
      </fieldset>
      {choicesError && <div className="form-error" role="alert">{choicesError} <button type="button" className="button ghost" onClick={() => setChoicesRetry(value => value + 1)}>Retry wallet and category choices</button></div>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {conflict && <button type="button" className="button ghost" disabled={busy} onClick={() => void reloadConflict()}>Reload latest entry</button>}
    </form>}
    </Modal>
    <Modal open={recordingHelp} title="Recording and reminders" size="small" onClose={() => setRecordingHelp(false)}>
      <p>Choose Plan only to record the actual transaction yourself. Record automatically adds the entry at the next server check after the due time.</p>
      <p>Expense reminders use your device’s notification permissions and settings.</p>
    </Modal>
    <div className="poc-list" aria-live="polite">
      {loading ? <p className="muted">Loading upcoming records…</p> : displayed.length === 0 ? !plansError && <p className="muted">No entries in this view.</p> : displayed.map(row => <button type="button" className="poc-line plan-row" key={row.id} onClick={() => setSelectedId(row.id)}>
        <span className="poc-marker"><CalendarClock size={18} aria-hidden="true"/></span>
        <span><strong>{row.description}</strong><small>{showTime(row.date)} · {row.wallet_name}</small><span className={`upcoming-status ${row.status}`}>{planLabel(row)}</span></span>
        <strong className={`upcoming-amount ${row.type}`}>{amountLabel(row)}</strong>
      </button>)}
    </div>
    <Modal open={detailsOpen} onClose={() => setDetailsOpen(false)} title="Upcoming details" size="small">
      <div className="stack gap-16">
        <label className="field"><span>Wallet context</span><AppSelect value={scope} onChange={event => setScope(event.target.value)}><option value="all">All wallets</option><option value="personal">Personal</option><option value="shared">Shared</option></AppSelect></label>
        {filter !== 'posted' && <label className="field"><span>Plan status</span><AppSelect value={status} onChange={event => setStatus(event.target.value)}><option value="">Any status</option>{Object.entries(recordingOptions).map(([value,label]) => <option key={value} value={value}>{label}</option>)}<option value="failed">Needs attention</option></AppSelect></label>}
        <p><strong>Net planned</strong> {money(total, settings.currency)}</p>
      </div>
    </Modal>
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
