import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownLeft, ArrowRightLeft, ArrowUpRight, Repeat2 } from 'lucide-react'
import { dateInput, saveDate } from '../lib/time'
import { transactionErrors, focusInvalid } from '../lib/transactionForm'
import SearchableSelect from './SearchableSelect'
import TransactionTemplates from './TransactionTemplates'
import { readDraft, writeDraft, clearDraft } from '../lib/transactionDraft'
import { useApp } from '../App'
import Modal from './Modal'
import DateTimeField from './DateTimeField'
import { api, jsonBody, money } from '../lib/api'
import VoiceInputButton from './VoiceInputButton'
import { applyVoiceTransaction } from '../lib/voiceInput'
import BalancePreview from './BalancePreview'
import { transactionSaved } from '../lib/savedFeedback'

const blank = () => ({ type: 'expense', amount: '', description: '', notes: '', date: dateInput(), wallet_id: '', transfer_wallet_id: '', category_id: '', recurring_frequency: 'none', recurring_until: '' })

export default function TransactionModal({ open, onClose, onSaved, editing = null }) {
  const {user, settings, notify} = useApp()
  const draftKey = `flowbudget_tx_draft_${user.id}`
  const [form, setForm] = useState(blank())
  const [wallets, setWallets] = useState([])
  const [categories, setCategories] = useState([])
  const [error, setError] = useState('')
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [voiceActive, setVoiceActive] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const submitting = useRef(false)

  useEffect(() => {
    if (!open) return
    setError('')
    setErrors({})
    setLoading(true)
    setAdvanced(Boolean(editing?.recurring_frequency && editing.recurring_frequency !== 'none'))
    const controller = new window.AbortController()
    Promise.all([api('/api/wallets', {signal: controller.signal}), api('/api/categories', {signal: controller.signal})]).then(([w,c]) => {
      if (controller.signal.aborted) return
      w = w.filter(x => !x.is_shared || x.id === editing?.wallet_id || x.id === editing?.transfer_wallet_id)
      setWallets(w.filter(x => !x.archived || x.id === editing?.wallet_id || x.id === editing?.transfer_wallet_id)); setCategories(c)
      const base = editing ? {
        ...editing,
        date: dateInput(editing.date),
        transfer_wallet_id: editing.transfer_wallet_id || '', category_id: editing.category_id || '', recurring_until: editing.recurring_until || ''
      } : (readDraft(draftKey) || blank())
      if (!base.wallet_id || !w.some(wallet => String(wallet.id) === String(base.wallet_id))) base.wallet_id = w.find(wallet => !wallet.archived)?.id || ''
      setForm(base)
    }).catch(e=>{if (!controller.signal.aborted) setError(e.message)}).finally(() => {if (!controller.signal.aborted) setLoading(false)})
    return () => controller.abort()
  }, [open, editing, draftKey])

  const visibleCategories = useMemo(() => categories.filter(c => c.kind === form.type), [categories, form.type])
  const set = (k,v) => {
    setErrors(previous=>({...previous,[k]:''}))
    setForm(f => {const next={...f,[k]:v};if(!editing)writeDraft(draftKey,next);return next})
  }

  const applyVoice = transcript => {
    const result = applyVoiceTransaction(transcript, form, { wallets, categories })
    setForm(result.draft)
    if (!editing) writeDraft(draftKey,result.draft)
    setError(result.issues.join(' ') || (result.changed ? '' : 'No transaction fields recognized. Please try again.'))
    if (result.changed) notify?.('Voice applied. Review the fields before saving.')
  }

  const submit = async e => {
    e.preventDefault()
    if (submitting.current || loading || voiceActive) return
    const invalid = transactionErrors(form)
    setErrors(invalid)
    if (Object.keys(invalid).length) {
      if (invalid.recurring_until) setAdvanced(true)
      setError(Object.values(invalid)[0]); focusInvalid(e.currentTarget); return
    }
    submitting.current = true; setBusy(true); setError('')
    try {
    const payload = {
      ...form, description: form.description.trim() || visibleCategories.find(c => String(c.id) === String(form.category_id))?.name || (form.type === 'transfer' ? 'Transfer' : form.type === 'income' ? 'Income' : 'Expense'), amount: Number(form.amount), wallet_id: Number(form.wallet_id),
      transfer_wallet_id: form.type === 'transfer' ? Number(form.transfer_wallet_id) : null,
      category_id: form.type === 'transfer' || !form.category_id ? null : Number(form.category_id),
      date: saveDate(form.date), recurring_until: form.recurring_frequency === 'none' ? null : form.recurring_until,
    }
      const saved = await api(editing ? `/api/transactions/${editing.id}` : '/api/transactions', { method: editing ? 'PUT' : 'POST', ...jsonBody(payload) })
      if (!editing) clearDraft(draftKey)
      transactionSaved(saved)
      onSaved?.(saved)
    } catch (err) { setError(err.status === 409 ? 'This transaction changed elsewhere. Your edits are still here. Close and reopen the record to review the latest version before applying them.' : err.message) }
    finally { submitting.current = false; setBusy(false) }
  }

  return <Modal open={open} onClose={() => !busy && onClose()} title={editing ? 'Edit transaction' : 'Add transaction'}>
    <form onSubmit={submit} noValidate className="stack gap-18 transaction-form">
      <fieldset className="transaction-fields stack gap-18" disabled={busy || loading}>
      <div className="segment-control three">
        <button type="button" className={form.type === 'expense' ? 'active' : ''} onClick={() => {set('type','expense');set('category_id','')}}><ArrowUpRight size={17}/>Expense</button>
        <button type="button" className={form.type === 'income' ? 'active' : ''} onClick={() => {set('type','income');set('category_id','')}}><ArrowDownLeft size={17}/>Income</button>
        <button type="button" className={form.type === 'transfer' ? 'active' : ''} onClick={() => set('type','transfer')}><ArrowRightLeft size={17}/>Transfer</button>
      </div>

      <VoiceInputButton disabled={busy || loading || !open} onActiveChange={setVoiceActive} onTranscript={applyVoice} onError={message => setError(message)}/>
      {!editing && <TransactionTemplates userId={user.id} scope="personal" draft={form} disabled={busy || loading} onApply={item => {
        const wallet = wallets.find(w => String(w.id) === String(item.wallet_id))
        if (!wallet) { setError('This template wallet is no longer available. Choose another template or enter the fields.'); return }
        const next = {...form, type:item.type, amount:item.amount, description:item.description, wallet_id:wallet.id, transfer_wallet_id:wallets.some(w => String(w.id) === String(item.transfer_wallet_id)) ? item.transfer_wallet_id : '', category_id:categories.some(c => String(c.id) === String(item.category_id) && c.kind === item.type) ? item.category_id : ''}
        setForm(next); setError(''); setErrors({})
        writeDraft(draftKey,next)
      }}/>}

      <label className="amount-input"><span>Amount ({settings.currency})</span><input required type="number" step="0.001" min="0.001" aria-invalid={Boolean(errors.amount)} aria-describedby={errors.amount ? 'personal-amount-error' : undefined} value={form.amount} onChange={e => {set('amount',e.target.value);setErrors(v=>({...v,amount:''}))}} placeholder="0.000" /></label>
      {errors.amount && <small id="personal-amount-error" className="field-error">{errors.amount}</small>}
      <label className="field"><span>Description</span><input maxLength="160" value={form.description} onChange={e => set('description',e.target.value)} placeholder="What was this for?"/></label>

      <DateTimeField value={form.date} onChange={value => set('date',value)} disabled={busy || loading}/>
      {errors.date && <small className="field-error">{errors.date}</small>}
      <div className="form-grid two transaction-wallet-fields">
        <SearchableSelect label={form.type === 'transfer' ? 'From wallet' : 'Wallet'} value={form.wallet_id} onChange={v => set('wallet_id',v)} disabled={busy || loading} error={errors.wallet_id} recentKey={`budgetly:recent:${user.id}:wallets`} options={wallets.map(w => ({value:w.id,label:`${w.name} · ${money(w.balance,settings.currency)}`}))}/>
        {form.type === 'transfer' ? <SearchableSelect label="To wallet" value={form.transfer_wallet_id} onChange={v => set('transfer_wallet_id',v)} disabled={busy || loading} error={errors.transfer_wallet_id} options={wallets.filter(w => String(w.id) !== String(form.wallet_id)).map(w => ({value:w.id,label:w.name}))}/> : <SearchableSelect label="Category" placeholder="Uncategorized" value={form.category_id} onChange={v => set('category_id',v)} disabled={busy || loading} recentKey={`budgetly:recent:${user.id}:categories`} options={visibleCategories.map(c => ({value:c.id,label:c.name}))}/>}
      </div>
      <BalancePreview wallet={wallets.find(w=>String(w.id)===String(form.wallet_id))} draft={form} editing={editing} currency={settings.currency}/>
      <details className="form-options" open={advanced} onToggle={e => setAdvanced(e.currentTarget.open)}><summary>More options</summary><div className="stack gap-16">
        {!editing && <button className="button ghost small" type="button" disabled={busy || voiceActive} onClick={() => {clearDraft(draftKey);setForm({...blank(),wallet_id:wallets[0]?.id || ''});setErrors({});setError('')}}>Discard draft</button>}
        <label className="field"><span><Repeat2 size={15}/> Repeat</span><select value={form.recurring_frequency} onChange={e => set('recurring_frequency',e.target.value)}><option value="none">Does not repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></label>
        {form.recurring_frequency !== 'none' && <label className="field"><span>Repeat until</span><input aria-label="Repeat until" required aria-invalid={Boolean(errors.recurring_until)} min={form.date.slice(0,10)} type="date" value={form.recurring_until} onChange={e => set('recurring_until',e.target.value)} />{errors.recurring_until && <small className="field-error">{errors.recurring_until}</small>}</label>}

        <label className="field"><span>Notes (optional)</span><textarea rows="3" value={form.notes} onChange={e => set('notes', e.target.value)}/></label>
      </div></details>
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="modal-actions"><button type="button" className="button ghost" disabled={busy} onClick={onClose}>Cancel</button><button className="button primary" disabled={busy || loading || voiceActive}>{loading ? 'Loading wallets...' : busy ? 'Saving…' : editing ? 'Save changes' : 'Add transaction'}</button></div>
      </fieldset>
    </form>
  </Modal>
}
