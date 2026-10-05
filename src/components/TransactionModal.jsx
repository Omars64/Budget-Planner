import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ArrowDownLeft, ArrowRightLeft, ArrowUpRight, Repeat2 } from 'lucide-react'
import { dateInput, saveDate } from '../lib/time'
import { transactionErrors, focusInvalid } from '../lib/transactionForm'
import SearchableSelect from './SearchableSelect'
import TransactionTemplates from './TransactionTemplates'
import { readDraft, writeDraft, clearDraft } from '../lib/transactionDraft'
import { useApp } from '../App'
import Modal from './Modal'
import DateTimeField, { DateField } from './DateTimeField'
import { api, jsonBody, money } from '../lib/api'
import VoiceInputButton from './VoiceInputButton'
import { applyVoiceTransaction } from '../lib/voiceInput'
import BalancePreview from './BalancePreview'
import { transactionSaved } from '../lib/savedFeedback'
import ReportingMonthField from './ReportingMonthField'
import RecentDescriptions from './RecentDescriptions'
import { recentEntries, rememberEntry, useWorkspacePreferences } from '../lib/workspacePreferences'

const blank = () => ({ type: 'expense', amount: '', description: '', notes: '', date: dateInput(), reporting_month: '', wallet_id: '', transfer_wallet_id: '', category_id: '', recurring_frequency: 'none', recurring_until: '' })

export default function TransactionModal({ open, onClose, onSaved, editing = null }) {
  const {user, settings, notify, isGuest, requestSignIn} = useApp()
  const [helpers] = useWorkspacePreferences(user.id)
  const formId = useId()
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
  const [schedule, setSchedule] = useState(false)
  const submitting = useRef(false)
  const baseline = useRef('')

  useEffect(() => {
    if (!open) return
    setError('')
    setErrors({})
    setLoading(true)
    setAdvanced(Boolean(editing?.recurring_frequency && editing.recurring_frequency !== 'none'))
    const resumeSchedule = !editing && !isGuest && sessionStorage.getItem(`budgetly_schedule_resume_${user.id}`) === 'true'
    setSchedule(resumeSchedule)
    const controller = new window.AbortController()
    Promise.all([api('/api/wallets', {signal: controller.signal}), api('/api/categories', {signal: controller.signal})]).then(([w,c]) => {
      if (controller.signal.aborted) return
      w = w.filter(x => !x.is_shared || x.id === editing?.wallet_id || x.id === editing?.transfer_wallet_id)
      setWallets(w.filter(x => !x.archived || x.id === editing?.wallet_id || x.id === editing?.transfer_wallet_id)); setCategories(c)
      const base = editing ? {
        ...editing,
        date: dateInput(editing.date),
        reporting_month: editing.reporting_month || String(editing.date || '').slice(0, 7),
        transfer_wallet_id: editing.transfer_wallet_id || '', category_id: editing.category_id || '', recurring_until: editing.recurring_until || ''
      } : (readDraft(draftKey) || (() => {
        const base = blank(), recent = recentEntries(user.id,'personal').find(item => item.type === base.type && w.some(wallet => !wallet.archived && String(wallet.id) === String(item.wallet_id)))
        return recent ? {...base,wallet_id:recent.wallet_id,category_id:c.some(category => category.id === Number(recent.category_id) && category.kind === base.type) ? recent.category_id : ''} : base
      })())
      if (!base.wallet_id || !w.some(wallet => String(wallet.id) === String(base.wallet_id) && (!wallet.archived || editing))) base.wallet_id = w.find(wallet => !wallet.archived)?.id || ''
      baseline.current = JSON.stringify(base)
      setForm(base)
      if (resumeSchedule) sessionStorage.removeItem(`budgetly_schedule_resume_${user.id}`)
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
    if (schedule && (form.recurring_frequency !== 'none' || form.recurring_until)) {
      setError('Scheduled entries must be one-time. Turn off Repeat first.'); setAdvanced(true); return
    }
    setErrors(invalid)
    if (Object.keys(invalid).length) {
      if (invalid.recurring_until) setAdvanced(true)
      setError(Object.values(invalid)[0]); focusInvalid(e.currentTarget); return
    }
    if (schedule && new Date(saveDate(form.date)).getTime() <= Date.now()) {
      setError('Choose a future date and time to schedule this entry.'); return
    }
    submitting.current = true; setBusy(true); setError('')
    try {
    const payload = {
      ...form, description: form.description.trim() || visibleCategories.find(c => String(c.id) === String(form.category_id))?.name || (form.type === 'transfer' ? 'Transfer' : form.type === 'income' ? 'Income' : 'Expense'), amount: Number(form.amount), wallet_id: Number(form.wallet_id),
      transfer_wallet_id: form.type === 'transfer' ? Number(form.transfer_wallet_id) : null,
      category_id: form.type === 'transfer' || !form.category_id ? null : Number(form.category_id),
      reporting_month: form.reporting_month || null,
      date: saveDate(form.date), recurring_until: form.recurring_frequency === 'none' ? null : form.recurring_until,
    }
      const saved = await api(schedule ? '/api/planned-transactions' : editing ? `/api/transactions/${editing.id}` : '/api/transactions', { method: editing ? 'PUT' : 'POST', ...jsonBody(schedule ? {transaction: payload, status: 'scheduled', reminder_enabled: true} : payload) })
      if (!editing) { rememberEntry(user.id,'personal',payload); clearDraft(draftKey) }
      if (!schedule && !saved.queued) transactionSaved(saved)
      onSaved?.(saved, schedule)
    } catch (err) { setError(err.status === 409 ? 'This transaction changed elsewhere. Your edits are still here. Close and reopen the record to review the latest version before applying them.' : err.message) }
    finally { submitting.current = false; setBusy(false) }
  }

  return <Modal preserveDraft={!editing} protectChanges={Boolean(editing)} isDirty={Boolean(editing && baseline.current && JSON.stringify(form) !== baseline.current)} open={open} onClose={() => !busy && onClose()} title={editing ? 'Edit transaction' : 'Add transaction'} footer={close => <div className="modal-actions"><button type="button" className="button ghost" disabled={busy} onClick={close}>Cancel</button><button type="submit" form={formId} className="button primary" disabled={busy || loading || voiceActive}>{loading ? 'Loading wallets...' : busy ? 'Saving…' : editing ? 'Save changes' : schedule ? 'Schedule entry' : 'Add transaction'}</button></div>}>
    <form id={formId} onSubmit={submit} noValidate className="stack gap-18 transaction-form">
      <fieldset className="transaction-fields stack gap-18" disabled={busy || loading}>
      <div className="segment-control three" role="group" aria-label="Transaction type">
        <button type="button" aria-pressed={form.type === 'expense'} className={form.type === 'expense' ? 'active' : ''} onClick={() => {set('type','expense');set('category_id','')}}><ArrowUpRight size={17}/>Expense</button>
        <button type="button" aria-pressed={form.type === 'income'} className={form.type === 'income' ? 'active' : ''} onClick={() => {set('type','income');set('category_id','')}}><ArrowDownLeft size={17}/>Income</button>
        <button type="button" aria-pressed={form.type === 'transfer'} className={form.type === 'transfer' ? 'active' : ''} onClick={() => set('type','transfer')}><ArrowRightLeft size={17}/>Transfer</button>
      </div>
      {!editing && <div className="segment-control" role="group" aria-label="When to record"><button type="button" aria-pressed={!schedule} className={!schedule ? 'active' : ''} onClick={() => setSchedule(false)}>Record now</button><button type="button" aria-pressed={schedule} className={schedule ? 'active' : ''} onClick={() => {if(isGuest){writeDraft(draftKey,form);sessionStorage.setItem('budgetly_guest_schedule','true');notify('Sign in to schedule. Your draft is kept.','success',{label:'Sign in',run:async()=>requestSignIn('scheduled transactions')})}else setSchedule(true)}}>Schedule</button></div>}
      {schedule && <p className="form-note">Added after the due time on your next visit or the daily check. Your balance stays unchanged until then.</p>}

      <VoiceInputButton disabled={busy || loading || !open} onActiveChange={setVoiceActive} onTranscript={applyVoice} onError={message => setError(message)}/>
      {!editing && !isGuest && helpers.entryTemplates && <TransactionTemplates userId={user.id} scope="personal" draft={form} disabled={busy || loading} onApply={item => {
        const wallet = wallets.find(w => String(w.id) === String(item.wallet_id))
        if (!wallet) { setError('This template wallet is no longer available. Choose another template or enter the fields.'); return }
        const next = {...form, type:item.type, amount:item.amount, description:item.description, wallet_id:wallet.id, transfer_wallet_id:wallets.some(w => String(w.id) === String(item.transfer_wallet_id)) ? item.transfer_wallet_id : '', category_id:categories.some(c => String(c.id) === String(item.category_id) && c.kind === item.type) ? item.category_id : '', reporting_month:item.type === 'income' ? '' : form.reporting_month}
        setForm(next); setError(''); setErrors({})
        writeDraft(draftKey,next)
      }}/>}

      <label className="amount-input"><span>Amount ({settings.currency})</span><input required type="number" step="0.001" min="0.001" aria-invalid={Boolean(errors.amount)} aria-describedby={errors.amount ? 'personal-amount-error' : undefined} value={form.amount} onChange={e => {set('amount',e.target.value);setErrors(v=>({...v,amount:''}))}} placeholder="0.000" /></label>
      {errors.amount && <small id="personal-amount-error" className="field-error">{errors.amount}</small>}
      <RecentDescriptions userId={user.id} scope="personal" type={form.type} value={form.description} onChange={value => set('description',value)} disabled={busy || loading}/>

      <DateTimeField value={form.date} onChange={value => set('date',value)} disabled={busy || loading}/>
      {errors.date && <small className="field-error">{errors.date}</small>}
      {form.type !== 'transfer' && <ReportingMonthField value={form.reporting_month} type={form.type} error={errors.reporting_month} disabled={busy || loading} onChange={value => set('reporting_month',value)}/>}
      <div className="form-grid two transaction-wallet-fields">
        <SearchableSelect rememberRecent={helpers.recentChoiceOrder && helpers.rememberEntry} label={form.type === 'transfer' ? 'From wallet' : 'Wallet'} value={form.wallet_id} onChange={v => set('wallet_id',v)} disabled={busy || loading} error={errors.wallet_id} recentKey={`budgetly:recent:${user.id}:wallets`} options={wallets.map(w => ({value:w.id,label:`${w.name} · ${money(w.balance,settings.currency)}`}))}/>
        {form.type === 'transfer' ? <SearchableSelect rememberRecent={helpers.recentChoiceOrder && helpers.rememberEntry} label="To wallet" value={form.transfer_wallet_id} onChange={v => set('transfer_wallet_id',v)} disabled={busy || loading} error={errors.transfer_wallet_id} options={wallets.filter(w => String(w.id) !== String(form.wallet_id)).map(w => ({value:w.id,label:w.name}))}/> : <SearchableSelect rememberRecent={helpers.recentChoiceOrder && helpers.rememberEntry} label="Category" placeholder="Uncategorized" value={form.category_id} onChange={v => set('category_id',v)} disabled={busy || loading} recentKey={`budgetly:recent:${user.id}:categories`} options={visibleCategories.map(c => ({value:c.id,label:c.name}))}/>}
      </div>
      {!schedule && helpers.balancePreview && <BalancePreview wallet={wallets.find(w=>String(w.id)===String(form.wallet_id))} draft={form} editing={editing} currency={settings.currency}/>}
      <details className="form-options" open={advanced} onToggle={e => setAdvanced(e.currentTarget.open)}><summary>More options</summary><div className="stack gap-16">
        {!editing && <button className="button ghost small" type="button" disabled={busy || voiceActive} onClick={() => {clearDraft(draftKey);setForm({...blank(),wallet_id:wallets[0]?.id || ''});setErrors({});setError('')}}>Discard draft</button>}
        <label className="field"><span><Repeat2 size={15}/> Repeat</span><select value={form.recurring_frequency} onChange={e => {if(isGuest && e.target.value!=='none')requestSignIn('repeating transactions');else set('recurring_frequency',e.target.value)}}><option value="none">Does not repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></label>
        {form.recurring_frequency !== 'none' && <div><DateField label="Repeat until" value={form.recurring_until} min={form.date.slice(0,10)} onChange={value => set('recurring_until',value)} disabled={busy || loading}/>{errors.recurring_until && <small className="field-error">{errors.recurring_until}</small>}</div>}

        <label className="field"><span>Notes (optional)</span><textarea rows="3" value={form.notes} onChange={e => set('notes', e.target.value)}/></label>
      </div></details>
      {error && <div className="form-error" role="alert">{error}</div>}
      </fieldset>
    </form>
  </Modal>
}
