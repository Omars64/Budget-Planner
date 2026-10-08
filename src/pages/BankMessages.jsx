import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { ArrowRightLeft, Check, ClipboardPaste, RefreshCw, RotateCcw, X } from 'lucide-react'
import { useApp } from '../App'
import { api, jsonBody } from '../lib/api'
import { categoryChoices } from '../lib/categoryChoices'
import { dateInput, saveDate, showTime } from '../lib/time'
import { currencyStep } from '../lib/currency'
import { parseBankNotification, notificationHash } from '../lib/bankNotifications/parser'
import { bankInboxChanged, syncBankNotifications } from '../lib/bankNotifications/native'
import BankNotificationSetup from '../components/BankNotificationSetup'
import Modal from '../components/Modal'
import DateTimeField from '../components/DateTimeField'
import './BankMessages.css'

const LegacyBankMessages = lazy(() => import('./LegacyBankMessages'))
const kinds = { expense: 'Expense', income: 'Income', refund: 'Refund / reversal', transfer: 'Transfer', withdrawal: 'ATM withdrawal' }

export default function BankMessages() {
  const { user, settings, activeSpace, spaces, refresh, notify, canAdd } = useApp()
  const [rows, setRows] = useState([]), [total, setTotal] = useState(0), [status, setStatus] = useState('pending'), [page, setPage] = useState(1)
  const [wallets, setWallets] = useState([]), [categories, setCategories] = useState([])
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [loading, setLoading] = useState(true)
  const [paste, setPaste] = useState(false), [text, setText] = useState(''), [bank, setBank] = useState('nbk')
  const [selected, setSelected] = useState(null), [form, setForm] = useState({})
  const [route, setRoute] = useState(null), [target, setTarget] = useState('personal'), [targetWallets, setTargetWallets] = useState([]), [routeWallet, setRouteWallet] = useState('')
  const [setup, setSetup] = useState(false), [legacy, setLegacy] = useState(false)
  const load = useCallback(async () => {
    const result = await api(`/api/bank-inbox?status=${status}&page=${page}`)
    setRows(result.items); setTotal(result.total)
  }, [status, page])
  useEffect(() => {
    let alive = true
    setLoading(true)
    Promise.all([api(`/api/bank-inbox?status=${status}&page=${page}`), api('/api/wallets'), api('/api/categories')]).then(([result, accounts, cats]) => {
      if (alive) { setRows(result.items); setTotal(result.total); setWallets(accounts.filter(wallet => !wallet.archived)); setCategories(cats) }
    }).catch(failure => { if (alive) setError(failure.message) }).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [status, page])
  useEffect(() => {
    const changed = () => { void load().catch(failure => setError(failure.message)) }
    window.addEventListener(bankInboxChanged, changed)
    return () => window.removeEventListener(bankInboxChanged, changed)
  }, [load])
  useEffect(() => {
    if (!route) return
    let alive = true
    setRouteWallet('')
    setTargetWallets([])
    api(`/api/wallets?space_id=${target}`).then(accounts => { if (alive) setTargetWallets(accounts.filter(wallet => !wallet.archived)) }).catch(failure => { if (alive) setError(failure.message) })
    return () => { alive = false }
  }, [target, route])
  async function act(task) {
    if (busy) return
    setBusy(true); setError('')
    try { await task() } catch (failure) { setError(failure.message) } finally { setBusy(false) }
  }
  function review(row) {
    setError(''); setSelected(row)
    setForm({ type: row.transaction_type === 'refund' ? 'income' : ['transfer', 'withdrawal'].includes(row.transaction_type) ? 'transfer' : row.transaction_type,
      amount: row.amount, description: row.merchant, wallet_id: row.wallet_id || '', category_id: row.category_id || '',
      transfer_wallet_id: '', date: dateInput(row.occurred_at), reporting_month: '', notes: '', add_anyway: false, remember: true, refund_of_id: '' })
  }
  function pasteMessage(event) {
    event.preventDefault()
    void act(async () => {
      const raw = { text, packageName: `manual.${bank}`, appLabel: bank.toUpperCase() }
      const parsed = parseBankNotification(raw)
      if (!parsed.recognized) throw new Error('No transaction detected. Paste a payment alert, not a security code, offer or balance-only message.')
      const { recognized: _recognized, ...candidate } = parsed
      const result = await api('/api/bank-inbox/ingest', { method: 'POST', ...jsonBody({ ...candidate, source_package: raw.packageName, source_app: raw.appLabel, content_hash: await notificationHash(raw) }) })
      setPaste(false); setText(''); await load()
      notify(result.duplicate ? 'This message is already in your inbox' : `Alert added to ${spaces.find(space => space.id === result.space_id)?.name || 'Personal'} Bank Inbox`)
    })
  }
  function approve(event) {
    event.preventDefault()
    void act(async () => {
      await api(`/api/bank-inbox/${selected.id}/approve`, { method: 'POST', ...jsonBody({ ...form, wallet_id: Number(form.wallet_id), category_id: form.type === 'transfer' ? null : Number(form.category_id) || null,
        transfer_wallet_id: form.type === 'transfer' ? Number(form.transfer_wallet_id) : null, date: saveDate(form.date), reporting_month: form.reporting_month || null, refund_of_id: Number(form.refund_of_id) || null }) })
      setSelected(null); await load(); refresh(); notify('Bank transaction recorded')
    })
  }
  const duplicateWarning = selected && (selected.duplicates.length > 0 || error.includes('similar transaction'))
  return <div className="stack gap-18 bank-inbox">
    <div className="section-row"><div><h3>Bank Inbox</h3><small className="muted">{activeSpace?.name || 'Personal'} · {total} {status}</small></div><div className="button-row"><button type="button" className="icon-button" aria-label="Refresh bank inbox" disabled={busy} onClick={() => act(async () => { await syncBankNotifications(user.id); await load() })}><RefreshCw size={19}/></button><button type="button" className="button primary" disabled={!canAdd} onClick={() => setPaste(true)}><ClipboardPaste size={18}/>Paste message</button></div></div>
    <details className="bank-settings-disclosure" open={setup} onToggle={event => setSetup(event.currentTarget.open)}><summary>Bank notification setup</summary>{setup && <BankNotificationSetup/>}</details>
    <div className="tabs" role="tablist" aria-label="Bank inbox status">{['pending', 'ignored', 'approved'].map(value => <button key={value} type="button" role="tab" aria-selected={status === value} className={status === value ? 'active' : ''} onClick={() => { setStatus(value); setPage(1); setError('') }}>{value[0].toUpperCase() + value.slice(1)}</button>)}</div>
    {error && !selected && !paste && !route && <p className="form-error" role="alert">{error}</p>}
    {loading ? <p role="status">Loading bank alerts...</p> : !rows.length ? <div className="empty-state"><h3>No bank transactions {status === 'pending' ? 'waiting for review' : `marked ${status}`}</h3><button type="button" className="button ghost" onClick={() => setSetup(true)}>Configure bank notifications</button></div> : <div className="bank-inbox-list">{rows.map(row => <article className="bank-inbox-item" key={row.id}>
      <div className="section-row"><strong>{row.merchant}</strong><strong>{row.currency} {row.amount}</strong></div>
      <div className="bank-item-meta"><span>{kinds[row.transaction_type]}</span><span>{row.source_app}{row.account_last4 && ` ••••${row.account_last4}`}</span><span>{showTime(row.occurred_at)}</span><span>{wallets.find(wallet => wallet.id === row.wallet_id)?.name || 'Choose a wallet'}</span></div>
      <small>{row.confidence >= 0.9 ? 'High' : row.confidence >= 0.65 ? 'Medium' : 'Low'} confidence{row.duplicates.length > 0 && ' · Possible duplicate'}</small>
      {status === 'pending' && <div className="button-row"><button type="button" className="button primary small" disabled={busy || !canAdd} onClick={() => review(row)}><Check size={16}/>Review & add</button><button type="button" className="icon-button" aria-label={`Ignore ${row.merchant}`} disabled={busy || !canAdd} onClick={() => act(async () => { await api(`/api/bank-inbox/${row.id}/ignore`, { method: 'POST' }); await load() })}><X size={18}/></button><button type="button" className="icon-button" aria-label={`Move ${row.merchant} to a wallet or Space`} disabled={busy || !canAdd} onClick={() => { setRoute(row); setTarget(String(activeSpace?.id || 'personal')) }}><ArrowRightLeft size={18}/></button></div>}
      {status === 'ignored' && <button type="button" className="button ghost small" disabled={busy || !canAdd} onClick={() => act(async () => { await api(`/api/bank-inbox/${row.id}/restore`, { method: 'POST' }); await load() })}><RotateCcw size={16}/>Restore</button>}
      {status === 'approved' && <small>Recorded transaction #{row.transaction_id || 'removed'}</small>}
    </article>)}</div>}
    {total > 100 && <div className="button-row"><button className="button ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page}</span><button className="button ghost" disabled={page * 100 >= total} onClick={() => setPage(page + 1)}>Next</button></div>}
    {!activeSpace && <details className="bank-settings-disclosure" onToggle={event => setLegacy(event.currentTarget.open)}><summary>Previously saved bank messages</summary>{legacy && <Suspense fallback={<p>Loading saved messages...</p>}><LegacyBankMessages/></Suspense>}</details>}
    <Modal open={paste} onClose={() => { if (!busy) setPaste(false) }} title="Paste bank message"><form onSubmit={pasteMessage} className="stack gap-16"><label className="field"><span>Bank/source</span><input required value={bank} maxLength={80} pattern="[a-zA-Z0-9_.-]+" onChange={event => setBank(event.target.value.toLowerCase())}/></label><label className="field"><span>Transaction alert</span><textarea required maxLength={4000} rows={5} value={text} onChange={event => setText(event.target.value)} placeholder="Paste a purchase, income, refund or transfer alert"/></label><small className="muted">Only parsed transaction details are saved. Unmapped alerts go to Personal.</small>{error && <p role="alert" className="form-error">{error}</p>}<button disabled={busy} className="button primary">Add to inbox</button></form></Modal>
    <Modal open={!!selected} onClose={() => { if (!busy) setSelected(null) }} title={selected ? `Review ${kinds[selected.transaction_type].toLowerCase()}` : 'Review bank alert'}><form onSubmit={approve} className="stack gap-16">
      <small className="muted">{selected?.source_app} · {selected?.currency} · Requires approval</small>
      {selected?.reasons.includes('Transfer direction needs review') && <p role="status">Bank transfer: confirm the direction and whether both wallets are yours.</p>}
      {selected?.reasons.includes('Signed amount: direction needs review') && !selected.reasons.includes('Transfer direction needs review') && <p role="status">{selected.transaction_type === 'income' || selected.transaction_type === 'refund' ? 'Credit (+)' : 'Debit (-)'} detected. Confirm the payment details before recording.</p>}
      {selected && selected.currency !== settings.currency && <p role="alert" className="form-error">This alert uses {selected.currency}. Move it to a workspace using that currency; Budgetly does not convert it.</p>}
      <label className="field"><span>Record as</span><select disabled={selected?.transaction_type === 'refund'} value={form.type || 'expense'} onChange={event => setForm({ ...form, type: event.target.value, category_id: '', transfer_wallet_id: '' })}>{['expense', 'income', 'transfer'].map(kind => <option key={kind} value={kind}>{selected?.transaction_type === 'refund' && kind === 'income' ? 'Refund (wallet credit)' : kinds[kind]}</option>)}</select></label>
      <div className="form-grid two"><label className="field"><span>Amount ({selected?.currency})</span><input required type="number" min={currencyStep(selected?.currency)} step={currencyStep(selected?.currency)} value={form.amount || ''} onChange={event => setForm({ ...form, amount: event.target.value })}/></label><label className="field"><span>Wallet</span><select required value={form.wallet_id || ''} onChange={event => setForm({ ...form, wallet_id: event.target.value })}><option value="">Choose wallet</option>{wallets.map(wallet => <option key={wallet.id} value={wallet.id}>{wallet.name}</option>)}</select></label></div>
      {form.type === 'transfer' && <label className="field"><span>Destination wallet</span><select required value={form.transfer_wallet_id || ''} onChange={event => setForm({ ...form, transfer_wallet_id: event.target.value })}><option value="">Choose destination (cash for ATM)</option>{wallets.filter(wallet => String(wallet.id) !== String(form.wallet_id)).map(wallet => <option key={wallet.id} value={wallet.id}>{wallet.name}</option>)}</select></label>}
      <label className="field"><span>Description</span><input required maxLength={160} value={form.description || ''} onChange={event => setForm({ ...form, description: event.target.value })}/></label>
      {form.type !== 'transfer' && <label className="field"><span>Category</span><select value={form.category_id || ''} onChange={event => setForm({ ...form, category_id: event.target.value })}><option value="">Uncategorized</option>{categoryChoices(categories.filter(category => category.kind === form.type), activeSpace?.id, form.category_id).map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>}
      <DateTimeField value={form.date || dateInput()} onChange={date => setForm({ ...form, date })} disabled={busy}/>
      {form.type !== 'transfer' && <label className="field"><span>For month {form.type === 'income' ? '' : '(optional)'}</span><input type="month" required={form.type === 'income'} value={form.reporting_month || ''} onChange={event => setForm({ ...form, reporting_month: event.target.value })}/></label>}
      {!!selected?.refund_matches.length && <label className="field"><span>Link original expense (optional)</span><select value={form.refund_of_id || ''} onChange={event => setForm({ ...form, refund_of_id: event.target.value })}><option value="">No link</option>{selected.refund_matches.map(item => <option value={item.id} key={item.id}>#{item.id} · {item.description}</option>)}</select></label>}
      <details className="bank-settings-disclosure"><summary>More options</summary><label className="field"><span>Notes</span><textarea maxLength={2000} value={form.notes || ''} onChange={event => setForm({ ...form, notes: event.target.value })}/></label><label className="check-row"><input type="checkbox" checked={!!form.remember} onChange={event => setForm({ ...form, remember: event.target.checked })}/>Remember this merchant's category</label><ul>{selected?.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul></details>
      {duplicateWarning && <div className="bank-duplicate"><p>A similar transaction exists. Check before recording again.</p>{selected?.duplicates.map(item => <small key={item.id}>#{item.id} · {item.description} · {showTime(item.date)}</small>)}<label className="check-row"><input type="checkbox" checked={!!form.add_anyway} onChange={event => setForm({ ...form, add_anyway: event.target.checked })}/>I checked; add anyway</label></div>}
      {error && <p role="alert" className="form-error">{error}</p>}
      <div className="modal-actions"><button type="button" className="button ghost" disabled={busy} onClick={() => setSelected(null)}>Cancel</button><button className="button primary" disabled={busy || !canAdd || selected?.currency !== settings.currency || (duplicateWarning && !form.add_anyway)}>Approve transaction</button></div>
    </form></Modal>
    <Modal open={!!route} onClose={() => { if (!busy) setRoute(null) }} title="Move alert to wallet"><form className="stack gap-16" onSubmit={event => { event.preventDefault(); void act(async () => { await api(`/api/bank-inbox/${route.id}/route`, { method: 'POST', ...jsonBody({ wallet_id: Number(routeWallet) }) }); setRoute(null); await load(); notify('Alert moved. Review it in its destination Bank Inbox.') }) }}><label className="field"><span>Workspace</span><select value={target} onChange={event => setTarget(event.target.value)}><option value="personal">Personal</option>{spaces.filter(space => space.role !== 'view').map(space => <option key={space.id} value={space.id}>{space.name}</option>)}</select></label><label className="field"><span>Wallet</span><select required value={routeWallet} onChange={event => setRouteWallet(event.target.value)}><option value="">Choose wallet</option>{targetWallets.map(wallet => <option value={wallet.id} key={wallet.id}>{wallet.name}</option>)}</select></label>{error && <p role="alert" className="form-error">{error}</p>}<button disabled={busy} className="button primary">Move alert</button></form></Modal>
  </div>
}
