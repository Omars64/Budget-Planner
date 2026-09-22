import { useState } from 'react'
import { List } from 'lucide-react'
import { useApp } from '../App'
import { money } from '../lib/api'
import useLedger from '../lib/useLedger'
import { defaultLedgerFilters } from './LedgerFilters'
import LedgerRow, { TransactionDetails } from './LedgerRow'
import LedgerPagination from './LedgerPagination'
import Modal from './Modal'

function Records({ budget }) {
  const {settings,refreshKey} = useApp()
  const [selected,setSelected] = useState(null)
  const ledger = useLedger('/api/transactions',{...defaultLedgerFilters,type:'expense',category:budget.category_id ? String(budget.category_id) : '',scope:'all',date_from:budget.records_from,exclude_opening:true},refreshKey)
  const fmt = value => money(value,settings.currency,settings.compact_numbers)
  return <><p className="muted">Owned wallets · {fmt(budget.spent)} spent</p>{ledger.error ? <div role="alert" className="form-error">{ledger.error}<button className="button ghost" onClick={ledger.retry}>Retry</button></div> : ledger.loading ? <p role="status">Loading records...</p> : ledger.rows.length ? ledger.rows.map(tx=><LedgerRow key={tx.id} tx={tx} fmt={fmt} showDate onOpen={()=>setSelected(tx)}/>) : <p>No matching expenses.</p>}<LedgerPagination ledger={ledger}/><TransactionDetails tx={selected} fmt={fmt} onClose={()=>setSelected(null)}/></>
}
export default function BudgetRecords({ budget, children }) {
  const [open,setOpen] = useState(false)
  return <><button className={children ? 'budget-amounts record-total' : 'text-button'} onClick={()=>setOpen(true)} aria-label={`View ${budget.name} records`}>{children || <><List size={16}/>View records</>}</button><Modal open={open} title={budget.name} onClose={()=>setOpen(false)}>{open && <Records budget={budget}/>}</Modal></>
}
