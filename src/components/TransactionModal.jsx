import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownLeft, ArrowRightLeft, ArrowUpRight, CalendarClock, Repeat2 } from 'lucide-react'
import { dateInput, saveDate } from '../lib/time'
import { useApp } from '../App'
import Modal from './Modal'
import { api, jsonBody, money } from '../lib/api'

const blank = () => ({ type: 'expense', amount: '', description: '', notes: '', date: dateInput(), wallet_id: '', transfer_wallet_id: '', category_id: '', recurring_frequency: 'none', recurring_until: '' })

export default function TransactionModal({ open, onClose, onSaved, editing = null }) {
  const {user, settings, notify} = useApp()
  const [templates,setTemplates] = useState([])
  const [templateName,setTemplateName] = useState('')
  const draftKey = `flowbudget_tx_draft_${user.id}`
  const [form, setForm] = useState(blank())
  const [wallets, setWallets] = useState([])
  const [categories, setCategories] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submitting = useRef(false)

  useEffect(() => {
    if (!open) return
    setError('')
    api('/api/transaction-templates').then(setTemplates).catch(e=>setError(e.message))
    Promise.all([api('/api/wallets'), api('/api/categories')]).then(([w,c]) => {
      setWallets(w.filter(x => !x.archived)); setCategories(c)
      const base = editing ? {
        ...editing,
        date: dateInput(editing.date),
        transfer_wallet_id: editing.transfer_wallet_id || '', category_id: editing.category_id || '', recurring_until: editing.recurring_until || ''
      } : (()=>{try{return JSON.parse(sessionStorage.getItem(draftKey)) || blank()}catch{return blank()}})()
      if (!base.wallet_id && w[0]) base.wallet_id = w[0].id
      setForm(base)
    }).catch(e=>setError(e.message))
  }, [open, editing])

  const visibleCategories = useMemo(() => categories.filter(c => c.kind === form.type), [categories, form.type])
  const set = (k,v) => setForm(f => {const next={...f,[k]:v};if(!editing){try{sessionStorage.setItem(draftKey,JSON.stringify(next))}catch{/* Storage may be disabled. */}}return next})

  const submit = async e => {
    e.preventDefault()
    if (submitting.current) return
    if (!form.description.trim() || !form.wallet_id || !(Number(form.amount) > 0) || !form.date) {
      setError('Enter a description, an amount greater than zero, a date, and a wallet.'); return
    }
    submitting.current = true; setBusy(true); setError('')
    try {
    const payload = {
      ...form, amount: Number(form.amount), wallet_id: Number(form.wallet_id),
      transfer_wallet_id: form.type === 'transfer' ? Number(form.transfer_wallet_id) : null,
      category_id: form.type === 'transfer' || !form.category_id ? null : Number(form.category_id),
      date: saveDate(form.date), recurring_until: form.recurring_until || null,
    }
      await api(editing ? `/api/transactions/${editing.id}` : '/api/transactions', { method: editing ? 'PUT' : 'POST', ...jsonBody(payload) })
      sessionStorage.removeItem(draftKey)
      onSaved?.()
    } catch (err) { setError(err.message) }
    finally { submitting.current = false; setBusy(false) }
  }

  return <Modal open={open} onClose={onClose} title={editing ? 'Edit transaction' : 'Add transaction'} subtitle="Keep each movement of money in the right place." size="large">
    <form onSubmit={submit} className="stack gap-18">
      {!editing&&<div className="template-controls"><label className="field"><span>Saved template</span><select defaultValue="" onChange={e=>{const t=templates.find(t=>String(t.id)===e.target.value);if(t)setForm({...t.transaction,date:dateInput(),amount:String(t.transaction.amount),recurring_until:t.transaction.recurring_until||''})}}><option value="">Choose template</option>{templates.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label><button type="button" className="button ghost" onClick={()=>{sessionStorage.removeItem(draftKey);setForm({...blank(),wallet_id:wallets[0]?.id||''})}}>Discard draft</button></div>}
      <div className="segment-control three">
        <button type="button" className={form.type === 'expense' ? 'active' : ''} onClick={() => set('type','expense')}><ArrowUpRight size={17}/>Expense</button>
        <button type="button" className={form.type === 'income' ? 'active' : ''} onClick={() => set('type','income')}><ArrowDownLeft size={17}/>Income</button>
        <button type="button" className={form.type === 'transfer' ? 'active' : ''} onClick={() => set('type','transfer')}><ArrowRightLeft size={17}/>Transfer</button>
      </div>

      <label className="amount-input"><span>Amount</span><input required type="number" step="0.001" min="0.001" value={form.amount} onChange={e => set('amount',e.target.value)} placeholder="0.000" /></label>

      <div className="form-grid two">
        <label className="field"><span>Description</span><input required maxLength="160" value={form.description} onChange={e => set('description',e.target.value)} placeholder="What was this for?" /></label>
        <label className="field"><span>Date & time (Kuwait)</span><div className="input-with-icon"><CalendarClock size={17}/><input required type="datetime-local" value={form.date} onChange={e => set('date',e.target.value)} /></div></label>
        <label className="field"><span>{form.type === 'transfer' ? 'From wallet' : 'Wallet'}</span><select required value={form.wallet_id} onChange={e => set('wallet_id',e.target.value)}>{wallets.map(w => <option key={w.id} value={w.id}>{w.name} · {money(w.balance,settings.currency)}</option>)}</select></label>
        {form.type === 'transfer' ? <label className="field"><span>To wallet</span><select required value={form.transfer_wallet_id} onChange={e => set('transfer_wallet_id',e.target.value)}><option value="">Select destination</option>{wallets.filter(w => String(w.id) !== String(form.wallet_id)).map(w => <option key={w.id} value={w.id}>{w.name} · {money(w.balance,settings.currency)}</option>)}</select></label> : <label className="field"><span>Category</span><select value={form.category_id} onChange={e => set('category_id',e.target.value)}><option value="">Uncategorized</option>{visibleCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
        <label className="field"><span><Repeat2 size={15}/> Repeat</span><select value={form.recurring_frequency} onChange={e => set('recurring_frequency',e.target.value)}><option value="none">Does not repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></label>
        {form.recurring_frequency !== 'none' && <label className="field"><span>Repeat until</span><input type="date" value={form.recurring_until} onChange={e => set('recurring_until',e.target.value)} /></label>}
      </div>
      <div className="balance-preview"><span>Current: {money(wallets.find(w=>String(w.id)===String(form.wallet_id))?.balance,settings.currency)}</span>{!editing&&<strong>After: {money(Number(wallets.find(w=>String(w.id)===String(form.wallet_id))?.balance||0)+(form.type==='income'?1:-1)*Number(form.amount||0),settings.currency)}</strong>}</div>
      <div className="template-controls"><label className="field"><span>Template name</span><input maxLength={100} value={templateName} onChange={e=>setTemplateName(e.target.value)}/></label><button type="button" className="button ghost" disabled={busy||!templateName.trim()||!form.description.trim()||!form.wallet_id||!(Number(form.amount)>0)} onClick={async()=>{setBusy(true);try{await api('/api/transaction-templates',{method:'POST',...jsonBody({name:templateName,transaction:{...form,date:saveDate(form.date),wallet_id:Number(form.wallet_id),transfer_wallet_id:form.type==='transfer'?Number(form.transfer_wallet_id):null,category_id:form.category_id?Number(form.category_id):null,recurring_until:form.recurring_until||null}})});setTemplates(await api('/api/transaction-templates'));notify('Template saved');setTemplateName('')}catch(e){setError(e.message)}finally{setBusy(false)}}}>Save template</button></div>
      <label className="field"><span>Notes</span><textarea rows="3" value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Optional details" /></label>
      {error && <div className="form-error">{error}</div>}
      <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cancel</button><button className="button primary" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Add transaction'}</button></div>
    </form>
  </Modal>
}
