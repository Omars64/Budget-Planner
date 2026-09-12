import { ArrowDownLeft, ArrowRightLeft, ArrowUpRight, Bus, Copy, Pencil, Repeat2, ShoppingBasket, Trash2, Utensils, Wallet } from 'lucide-react'
import { format } from 'date-fns'
import { displayDate } from '../lib/time'
import Modal from './Modal'

export default function LedgerRow({ tx, fmt, shared = false, onOpen }) {
  const name = (tx.category_name || '').toLowerCase()
  const Icon = tx.type === 'income' ? ArrowDownLeft : tx.type === 'transfer' ? ArrowRightLeft : name.includes('food') ? Utensils : name.includes('shop') ? ShoppingBasket : name.includes('transport') ? Bus : ArrowUpRight
  const wallets = shared ? tx.shared_wallet_names || [tx.wallet_name] : [tx.wallet_name, ...(tx.type === 'transfer' ? [tx.transfer_wallet_name] : [])]
  return <button className="ledger-entry" onClick={onOpen} aria-label={`View ${tx.description}`}>
    <span className={`tx-symbol ${tx.type} ${Icon === Utensils ? 'food' : Icon === ShoppingBasket ? 'shopping' : ''}`}><Icon size={20}/></span>
    <span className="tx-main"><strong>{tx.description}</strong><span className="wallet-label"><Wallet size={14} aria-hidden="true"/>{wallets.filter(Boolean).join(' / ')}{tx.recurring_frequency && tx.recurring_frequency !== 'none' && <Repeat2 size={13} aria-label="Recurring transaction"/>}</span></span>
    <span className="tx-side"><strong className={`tx-amount ${tx.type}`}>{tx.type === 'income' ? '+' : tx.type === 'expense' ? '-' : ''}{fmt(tx.amount)}</strong><small>{format(displayDate(tx.date), 'HH:mm')}</small></span>
  </button>
}

export function TransactionDetails({ tx, fmt, onClose, onEdit, onDelete, onDuplicate }) {
  return <Modal open={!!tx} onClose={onClose} title={tx?.description || 'Transaction'}>
    {tx && <div className="stack gap-18">
      <strong className={`detail-amount tx-amount ${tx.type}`}>{tx.type === 'income' ? '+' : tx.type === 'expense' ? '-' : ''}{fmt(tx.amount)}</strong>
      <dl className="transaction-details"><div><dt>Wallet</dt><dd>{tx.wallet_name || tx.shared_wallet_names?.join(' / ')}</dd></div>{tx.transfer_wallet_name && <div><dt>To wallet</dt><dd>{tx.transfer_wallet_name}</dd></div>}<div><dt>Category</dt><dd>{tx.category_name || (tx.type === 'transfer' ? 'Transfer' : 'Uncategorized')}</dd></div><div><dt>Recorded</dt><dd>{format(displayDate(tx.date), 'dd MMM yyyy, HH:mm')}</dd></div>{tx.owner_name && <div><dt>Wallet owner</dt><dd>{tx.owner_name}</dd></div>}{tx.recurring_frequency !== 'none' && tx.recurring_frequency && <div><dt>Repeat</dt><dd>{tx.recurring_frequency}{tx.recurring_until ? ` until ${tx.recurring_until}` : ' (set an end date when editing)'}</dd></div>}</dl>
      {tx.notes && <p className="transaction-note">{tx.notes}</p>}
      <div className="modal-actions">{onDuplicate && <button className="button ghost" onClick={onDuplicate}><Copy size={16}/>Duplicate</button>}{onEdit && <button className="button ghost" onClick={onEdit}><Pencil size={16}/>Edit</button>}{onDelete && <button className="button ghost danger" onClick={onDelete}><Trash2 size={16}/>Delete</button>}</div>
    </div>}
  </Modal>
}
