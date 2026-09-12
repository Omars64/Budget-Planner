import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownLeft, ArrowRightLeft, ArrowUpRight, CalendarClock, Repeat2 } from 'lucide-react'
import { dateInput, saveDate } from '../lib/time'
import { useApp } from '../App'
import Modal from './Modal'
import { api, jsonBody, money } from '../lib/api'

const blank = () => ({ type: 'expense', amount: '', description: '', notes: '', date: dateInput(), wallet_id: '', transfer_wallet_id: '', category_id: '', recurring_frequency: 'none', recurring_until: '' })

export default function TransactionModal({ open, onClose, onSaved, editing = null }) {
  const {user, settings} = useApp()
  const draftKey = `flowbudget_tx_draft_${user.id}`
  const [form, setForm] = useState(blank())
  const [wallets, setWallets] = useState([])
  const [categories, setCategories] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const submitting = useRef(false)

  useEffect(() => {
    if (!open) return
    setError('')
    setLoading(true)
    setAdvanced(Boolean(editing?.recurring_frequency && editing.recurring_frequency !== 'none'))
    const controller = new window.AbortController()
    Promise.all([api('/api/wallets', {signal: controller.signal}), api('/api/categories', {signal: controller.signal})]).then(([w,c]) => {
      if (controller.signal.aborted) return
      setWallets(w.filter(x => !x.archived || x.id === editing?.wallet_id)); setCategories(c)
      const base = editing ? {
        ...editing,
        date: dateInput(editing.date),
        transfer_wallet_id: editing.transfer_wallet_id || '', category_id: editing.category_id || '', recurring_until: editing.recurring_until || ''
      } : (()=>{try{return JSON.parse(sessionStorage.getItem(draftKey)) || blank()}catch{return blank()}})()
      if (!base.wallet_id || !w.some(wallet => String(wallet.id) === String(base.wallet_id))) base.wallet_id = w.find(wallet => !wallet.archived)?.id || ''
      setForm(base)
    }).catch(e=>{if (!controller.signal.aborted) setError(e.message)}).finally(() => {if (!controller.signal.aborted) setLoading(false)})
    return () => controller.abort()
  }, [open, editing, draftKey])

  const visibleCategories = useMemo(() => categories.filter(c => c.kind === form.type), [categories, form.type])
  const set = (k,v) => setForm(f => {const next={...f,[k]:v};if(!editing){try{sessionStorage.setItem(draftKey,JSON.stringify(next))}catch{/* Storage may be disabled. */}}return next})

  const submit = async e => {
    e.preventDefault()
    if (submitting.current || loading) return
    if (!(Number(form.amount) > 0)) { setError('Enter an amount greater than zero.'); return }
    if (!form.wallet_id) { setError('Choose a wallet. Create one in Wallets if none is available.'); return }
    if (!form.date) { setError('Choose a transaction date.'); return }
    if (form.type === 'transfer' && (!form.transfer_wallet_id || String(form.wallet_id) === String(form.transfer_wallet_id))) { setError('Choose a different destination wallet.'); return }
    if (form.recurring_frequency !== 'none' && (!form.recurring_until || form.recurring_until < form.date.slice(0,10))) {
      setAdvanced(true); setError('Choose a repeat-until date on or after the transaction date.'); return
    }
    submitting.current = true; setBusy(true); setError('')
    try {
    const payload = {
      ...form, description: form.description.trim() || visibleCategories.find(c => String(c.id) === String(form.category_id))?.name || (form.type === 'transfer' ? 'Transfer' : form.type === 'income' ? 'Income' : 'Expense'), amount: Number(form.amount), wallet_id: Number(form.wallet_id),
      transfer_wallet_id: form.type === 'transfer' ? Number(form.transfer_wallet_id) : null,
      category_id: form.type === 'transfer' || !form.category_id ? null : Number(form.category_id),
      date: saveDate(form.date), recurring_until: form.recurring_frequency === 'none' ? null : form.recurring_until,
    }
      await api(editing ? `/api/transactions/${editing.id}` : '/api/transactions', { method: editing ? 'PUT' : 'POST', ...jsonBody(payload) })
      sessionStorage.removeItem(draftKey)
      onSaved?.()
    } catch (err) { setError(err.message) }
    finally { submitting.current = false; setBusy(false) }
  }

  return <Modal open={open} onClose={() => !busy && onClose()} title={editing ? 'Edit transaction' : 'Add transaction'}>
    <form onSubmit={submit} noValidate className="stack gap-18 transaction-form">
      <div className="segment-control three">
        <button type="button" className={form.type === 'expense' ? 'active' : ''} onClick={() => {set('type','expense');set('category_id','')}}><ArrowUpRight size={17}/>Expense</button>
        <button type="button" className={form.type === 'income' ? 'active' : ''} onClick={() => {set('type','income');set('category_id','')}}><ArrowDownLeft size={17}/>Income</button>
        <button type="button" className={form.type === 'transfer' ? 'active' : ''} onClick={() => set('type','transfer')}><ArrowRightLeft size={17}/>Transfer</button>
      </div>

      <label className="amount-input"><span>Amount ({settings.currency})</span><input required type="number" step="0.001" min="0.001" value={form.amount} onChange={e => set('amount',e.target.value)} placeholder="0.000" /></label>

      <div className="form-grid two">
        <label className="field"><span>Date & time</span><div className="input-with-icon"><CalendarClock size={17}/><input required type="datetime-local" value={form.date} onChange={e => set('date',e.target.value)} /></div></label>
        <label className="field"><span>{form.type === 'transfer' ? 'From wallet' : 'Wallet'}</span><select required value={form.wallet_id} onChange={e => set('wallet_id',e.target.value)}>{wallets.map(w => <option key={w.id} value={w.id}>{w.name} · {money(w.balance,settings.currency)}</option>)}</select></label>
        {form.type === 'transfer' ? <label className="field"><span>To wallet</span><select required value={form.transfer_wallet_id} onChange={e => set('transfer_wallet_id',e.target.value)}><option value="">Select destination</option>{wallets.filter(w => String(w.id) !== String(form.wallet_id)).map(w => <option key={w.id} value={w.id}>{w.name} · {money(w.balance,settings.currency)}</option>)}</select></label> : <label className="field"><span>Category</span><select value={form.category_id} onChange={e => set('category_id',e.target.value)}><option value="">Uncategorized</option>{visibleCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
      </div>
      <div className="balance-preview"><span>Current: {money(wallets.find(w=>String(w.id)===String(form.wallet_id))?.balance,settings.currency)}</span>{!editing&&<strong>After: {money(Number(wallets.find(w=>String(w.id)===String(form.wallet_id))?.balance||0)+(form.type==='income'?1:-1)*Number(form.amount||0),settings.currency)}</strong>}</div>
      <details className="form-options" open={advanced} onToggle={e => setAdvanced(e.currentTarget.open)}><summary>More options</summary><div className="stack gap-16">
        <label className="field"><span>Description (optional)</span><input maxLength="160" value={form.description} onChange={e => set('description',e.target.value)} placeholder="What was this for?"/></label>
        <label className="field"><span><Repeat2 size={15}/> Repeat</span><select value={form.recurring_frequency} onChange={e => set('recurring_frequency',e.target.value)}><option value="none">Does not repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></label>
        {form.recurring_frequency !== 'none' && <label className="field"><span>Repeat until</span><input required min={form.date.slice(0,10)} type="date" value={form.recurring_until} onChange={e => set('recurring_until',e.target.value)} /></label>}

        <label className="field"><span>Notes (optional)</span><textarea rows="3" value={form.notes} onChange={e => set('notes', e.target.value)}/></label>
      </div></details>
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="modal-actions"><button type="button" className="button ghost" disabled={busy} onClick={onClose}>Cancel</button><button className="button primary" disabled={busy || loading}>{loading ? 'Loading wallets...' : busy ? 'Saving…' : editing ? 'Save changes' : 'Add transaction'}</button></div>
    </form>
  </Modal>
}
