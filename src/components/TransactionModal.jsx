import { useEffect, useMemo, useState } from 'react'
import { ArrowDownLeft, ArrowRightLeft, ArrowUpRight, CalendarClock, Repeat2 } from 'lucide-react'
import Modal from './Modal'
import { api, jsonBody } from '../lib/api'

const blank = () => ({ type: 'expense', amount: '', description: '', notes: '', date: new Date().toISOString().slice(0,16), wallet_id: '', transfer_wallet_id: '', category_id: '', recurring_frequency: 'none', recurring_until: '' })

export default function TransactionModal({ open, onClose, onSaved, editing = null }) {
  const [form, setForm] = useState(blank())
  const [wallets, setWallets] = useState([])
  const [categories, setCategories] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    Promise.all([api('/api/wallets'), api('/api/categories')]).then(([w,c]) => {
      setWallets(w.filter(x => !x.archived)); setCategories(c)
      const base = editing ? {
        ...editing,
        date: new Date(editing.date).toISOString().slice(0,16),
        transfer_wallet_id: editing.transfer_wallet_id || '', category_id: editing.category_id || '', recurring_until: editing.recurring_until || ''
      } : blank()
      if (!base.wallet_id && w[0]) base.wallet_id = w[0].id
      setForm(base)
    })
  }, [open, editing])

  const visibleCategories = useMemo(() => categories.filter(c => c.kind === form.type), [categories, form.type])
  const set = (k,v) => setForm(f => ({ ...f, [k]: v }))

  const submit = async e => {
    e.preventDefault(); setBusy(true); setError('')
    const payload = {
      ...form, amount: Number(form.amount), wallet_id: Number(form.wallet_id),
      transfer_wallet_id: form.type === 'transfer' ? Number(form.transfer_wallet_id) : null,
      category_id: form.type === 'transfer' || !form.category_id ? null : Number(form.category_id),
      date: new Date(form.date).toISOString(), recurring_until: form.recurring_until || null,
    }
    try {
      await api(editing ? `/api/transactions/${editing.id}` : '/api/transactions', { method: editing ? 'PUT' : 'POST', ...jsonBody(payload) })
      onSaved?.()
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  return <Modal open={open} onClose={onClose} title={editing ? 'Edit transaction' : 'Add transaction'} subtitle="Keep each movement of money in the right place." size="large">
    <form onSubmit={submit} className="stack gap-18">
      <div className="segment-control three">
        <button type="button" className={form.type === 'expense' ? 'active' : ''} onClick={() => set('type','expense')}><ArrowUpRight size={17}/>Expense</button>
        <button type="button" className={form.type === 'income' ? 'active' : ''} onClick={() => set('type','income')}><ArrowDownLeft size={17}/>Income</button>
        <button type="button" className={form.type === 'transfer' ? 'active' : ''} onClick={() => set('type','transfer')}><ArrowRightLeft size={17}/>Transfer</button>
      </div>

      <label className="amount-input"><span>Amount</span><input required type="number" step="0.001" min="0.001" value={form.amount} onChange={e => set('amount',e.target.value)} placeholder="0.000" /></label>

      <div className="form-grid two">
        <label className="field"><span>Description</span><input required maxLength="160" value={form.description} onChange={e => set('description',e.target.value)} placeholder="What was this for?" /></label>
        <label className="field"><span>Date & time</span><div className="input-with-icon"><CalendarClock size={17}/><input required type="datetime-local" value={form.date} onChange={e => set('date',e.target.value)} /></div></label>
        <label className="field"><span>{form.type === 'transfer' ? 'From wallet' : 'Wallet'}</span><select required value={form.wallet_id} onChange={e => set('wallet_id',e.target.value)}>{wallets.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
        {form.type === 'transfer' ? <label className="field"><span>To wallet</span><select required value={form.transfer_wallet_id} onChange={e => set('transfer_wallet_id',e.target.value)}><option value="">Select destination</option>{wallets.filter(w => String(w.id) !== String(form.wallet_id)).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label> : <label className="field"><span>Category</span><select value={form.category_id} onChange={e => set('category_id',e.target.value)}><option value="">Uncategorized</option>{visibleCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
        <label className="field"><span><Repeat2 size={15}/> Repeat</span><select value={form.recurring_frequency} onChange={e => set('recurring_frequency',e.target.value)}><option value="none">Does not repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></label>
        {form.recurring_frequency !== 'none' && <label className="field"><span>Repeat until</span><input type="date" value={form.recurring_until} onChange={e => set('recurring_until',e.target.value)} /></label>}
      </div>
      <label className="field"><span>Notes</span><textarea rows="3" value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Optional details" /></label>
      {error && <div className="form-error">{error}</div>}
      <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cancel</button><button className="button primary" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Add transaction'}</button></div>
    </form>
  </Modal>
}
