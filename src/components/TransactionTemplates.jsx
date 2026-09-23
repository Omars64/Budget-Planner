import { useState } from 'react'
import { BookmarkPlus, Trash2 } from 'lucide-react'

export default function TransactionTemplates({ userId, scope, draft, onApply, disabled }) {
  const key = `budgetly:templates:${userId}:${scope}`
  const [items, setItems] = useState(() => { try { const value = JSON.parse(localStorage.getItem(key)); return Array.isArray(value) ? value.slice(0, 12) : [] } catch { return [] } })
  const [selected, setSelected] = useState('')
  const [message, setMessage] = useState('')
  const persist = next => {
    try { localStorage.setItem(key, JSON.stringify(next)); setItems(next); setMessage('') }
    catch { setMessage('Templates could not be stored on this device.') }
  }
  const save = () => {
    if (!(Number(draft.amount) > 0) || !draft.wallet_id) { setMessage('Choose an amount and wallet first.'); return }
    const item = { id: crypto.randomUUID(), name: draft.description.trim() || 'Transaction', type: draft.type, amount: draft.amount, description: draft.description, wallet_id: draft.wallet_id, transfer_wallet_id: draft.transfer_wallet_id, category_id: draft.category_id }
    persist([item, ...items].slice(0, 12))
  }
  return <details className="form-options transaction-templates"><summary>Templates</summary><div className="stack gap-12">
    <label className="field"><span>Saved entries on this device</span><select disabled={disabled} value={selected} onChange={e => { setSelected(e.target.value); const item = items.find(i => i.id === e.target.value); if (item) onApply(item) }}><option value="">Choose a template</option>{items.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
    <div className="button-row"><button className="button ghost small" type="button" disabled={disabled} onClick={save}><BookmarkPlus size={16}/>Save current fields</button>{selected && <button type="button" className="icon-button" title="Delete template" aria-label="Delete template" disabled={disabled} onClick={() => { persist(items.filter(item => item.id !== selected)); setSelected('') }}><Trash2 size={16}/></button>}</div>
    {message && <small role="status">{message}</small>}
  </div></details>
}
