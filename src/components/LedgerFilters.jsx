import { Search, RotateCcw } from 'lucide-react'

export const defaultLedgerFilters = { search: '', type: 'all', wallet: '', month: '', sort: 'newest' }

export default function LedgerFilters({ value, onChange, wallets, shared = false }) {
  const update = (key, next) => onChange({ ...value, [key]: next })
  const changed = Object.keys(defaultLedgerFilters).some(key => value[key] !== defaultLedgerFilters[key])
  return <section className="toolbar glass ledger-filters" aria-label="Transaction filters">
    <label className="search-box"><Search size={18}/><input aria-label="Search transactions" value={value.search} onChange={e => update('search', e.target.value)} placeholder="Search transactions or notes"/></label>
    <div className="ledger-filter-fields">
      <label className="field"><span>Wallet</span><select aria-label="Wallet" value={value.wallet} onChange={e => update('wallet', e.target.value)}><option value="">{shared ? 'All shared wallets' : 'All wallets'}</option>{wallets.map(w => <option key={w.wallet_id ?? w.id} value={w.wallet_id ?? w.id}>{w.name}{shared ? ` (${w.is_owner ? 'You' : w.owner_name || w.owner_email})` : w.archived ? ' (Archived)' : ''}</option>)}</select></label>
      <label className="field"><span>Month (Kuwait)</span><input aria-label="Month (Kuwait)" type="month" min="1000-01" max="9999-12" value={value.month} onChange={e => update('month', e.target.value)}/></label>
      <label className="field"><span>Type</span><select aria-label="Type" value={value.type} onChange={e => update('type', e.target.value)}><option value="all">All types</option><option value="expense">Expenses</option><option value="income">Income</option><option value="transfer">Transfers</option></select></label>
      <label className="field"><span>Sort by</span><select aria-label="Sort by" value={value.sort} onChange={e => update('sort', e.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label>
    </div>
    {changed && <button className="button ghost small" onClick={() => onChange({ ...defaultLedgerFilters })}><RotateCcw size={16}/>Clear filters</button>}
  </section>
}
