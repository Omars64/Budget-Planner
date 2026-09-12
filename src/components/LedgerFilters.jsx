import { useState } from 'react'
import { ChevronLeft, ChevronRight, ListFilter, X } from 'lucide-react'
import Modal from './Modal'
import { dateInput } from '../lib/time'

export const defaultLedgerFilters = { search: '', type: 'all', wallet: '', month: '', sort: 'newest' }

export default function LedgerFilters({ value, onChange, wallets, shared = false, children }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  const update = (key, next) => setDraft(current => ({ ...current, [key]: next }))
  const active = Object.keys(defaultLedgerFilters).filter(key => value[key] !== defaultLedgerFilters[key])
  const monthLabel = value.month ? new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(value.month + '-01T12:00:00Z')) : 'All months'
  const shiftMonth = offset => {
    const date = new Date((value.month || dateInput().slice(0, 7)) + '-01T12:00:00Z')
    date.setUTCMonth(date.getUTCMonth() + (value.month ? offset : 0))
    onChange({ ...value, month: date.toISOString().slice(0, 7) })
  }
  const label = key => key === 'wallet' ? wallets.find(w => String(w.wallet_id ?? w.id) === value.wallet)?.name || 'Wallet' : key === 'month' ? monthLabel : key === 'search' ? 'Search: ' + value.search : key === 'sort' ? 'Oldest first' : value.type
  return <section className="ledger-filter-bar" aria-label="Transaction filters">
    <div className="ledger-toolbar">
      <div className="ledger-month"><button className="icon-button" aria-label="Previous month" onClick={() => shiftMonth(-1)}><ChevronLeft size={18}/></button><strong>{monthLabel}</strong><button className="icon-button" aria-label="Next month" onClick={() => shiftMonth(1)}><ChevronRight size={18}/></button></div>
      <div className="button-row">{children}<button className="icon-button filter-trigger" title="Filter transactions" aria-label="Filter transactions" onClick={() => { setDraft(value); setOpen(true) }}><ListFilter size={20}/>{active.length > 0 && <i aria-label={active.length + ' active filters'}/>}</button></div>
    </div>
    {active.length > 0 && <div className="active-filters">{active.map(key => <button key={key} onClick={() => onChange({ ...value, [key]: defaultLedgerFilters[key] })} aria-label={'Remove ' + key + ' filter'}><span>{label(key)}</span><X size={13}/></button>)}</div>}
    <Modal open={open} onClose={() => setOpen(false)} title="Filters">
      <form className="stack gap-16" onSubmit={e => { e.preventDefault(); onChange(draft); setOpen(false) }}>
        <label className="field"><span>Search</span><input value={draft.search} onChange={e => update('search', e.target.value)} placeholder="Transactions or notes"/></label>
        <label className="field"><span>Wallet</span><select aria-label="Wallet" value={draft.wallet} onChange={e => update('wallet', e.target.value)}><option value="">{shared ? 'All shared wallets' : 'All wallets'}</option>{wallets.map(w => <option key={w.wallet_id ?? w.id} value={w.wallet_id ?? w.id}>{w.name}{shared ? ' (' + (w.is_owner ? 'You' : w.owner_name || w.owner_email) + ')' : w.archived ? ' (Archived)' : ''}</option>)}</select></label>
        <label className="field"><span>Month</span><input type="month" min="1000-01" max="9999-12" value={draft.month} onChange={e => update('month', e.target.value)}/></label>
        <div className="form-grid two"><label className="field"><span>Type</span><select value={draft.type} onChange={e => update('type', e.target.value)}><option value="all">All types</option><option value="expense">Expenses</option><option value="income">Income</option><option value="transfer">Transfers</option></select></label>
          <label className="field"><span>Sort by</span><select value={draft.sort} onChange={e => update('sort', e.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label></div>
        <div className="modal-actions"><button type="button" className="button ghost" onClick={() => setDraft({ ...defaultLedgerFilters })}>Clear filters</button><button className="button primary">Apply filters</button></div>
      </form>
    </Modal>
  </section>
}
