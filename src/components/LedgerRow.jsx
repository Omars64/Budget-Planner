import { ArrowDownLeft, ArrowRightLeft, ArrowUpRight, Bus, Copy, Pencil, Repeat2, ShoppingBasket, Trash2, Utensils, Wallet } from 'lucide-react'
import { format } from 'date-fns'
import { dateInput, displayDate } from '../lib/time'
import Modal from './Modal'
import { Sparkles } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export function LedgerDateHeader({ day }) {
  const today = dateInput().slice(0, 10)
  const yesterday = new Date(`${today}T12:00:00`)
  yesterday.setDate(yesterday.getDate() - 1)
  const relative = day === today ? 'Today' : day === format(yesterday, 'yyyy-MM-dd') ? 'Yesterday' : ''
  return <div className="date-label"><strong className="ledger-date-title">{relative ? `${relative} · ` : ''}{format(new Date(`${day}T12:00:00`), 'EEEE, dd MMM yyyy')}</strong></div>
}

export default function LedgerRow({ tx, fmt, shared = false, showDate = false, onOpen }) {
  const name = (tx.category_name || '').toLowerCase()
  const Icon = tx.type === 'income' ? ArrowDownLeft : tx.type === 'transfer' ? ArrowRightLeft : name.includes('food') ? Utensils : name.includes('shop') ? ShoppingBasket : name.includes('transport') ? Bus : ArrowUpRight
  const title = tx.description?.trim() || tx.category_name || 'Unnamed transaction'
  const walletLabel = tx.type === 'transfer' ? `${tx.wallet_name || 'Wallet'} → ${tx.transfer_wallet_name || 'Wallet'}` : tx.wallet_name || tx.shared_wallet_names?.join(' / ')
  return <button className="ledger-entry" onClick={onOpen} aria-label={`View ${title}`}>
    <span className={`tx-symbol ${tx.type} ${Icon === Utensils ? 'food' : Icon === ShoppingBasket ? 'shopping' : ''}`}><Icon size={20}/></span>
    <span className="tx-main"><strong>{title}</strong><span className="tx-category">{tx.is_opening_balance ? (tx.type === 'income' ? 'Starting funds' : 'Starting debt') : tx.category_name || (tx.type === 'transfer' ? 'Wallet transfer' : 'Uncategorized')}</span><span className="wallet-label"><Wallet size={14} aria-hidden="true"/>{walletLabel}{tx.recurring_frequency && tx.recurring_frequency !== 'none' && <Repeat2 size={13} aria-label="Recurring transaction"/>}</span>{shared && <span className="tx-contributor">{tx.recorded_by_name ? `Added by ${tx.recorded_by_name}` : `Wallet owner: ${tx.owner_name || tx.owner_email || 'Unknown'}`}</span>}</span>
    <span className="tx-side"><strong className={`tx-amount ${tx.type}`}>{tx.type === 'income' ? '+\u00a0' : tx.type === 'expense' ? '-\u00a0' : ''}{fmt(tx.amount)}</strong><small className="tx-kind">{tx.type === 'income' ? 'Income' : tx.type === 'transfer' ? 'Transfer' : 'Expense'}</small><small>{format(displayDate(tx.date), showDate ? 'dd MMM, HH:mm' : 'HH:mm')}</small></span>
  </button>
}

export function TransactionDetails({ tx, fmt, onClose, onEdit, onDelete, onDuplicate }) {
  const navigate = useNavigate()
  return <Modal open={!!tx} onClose={onClose} title={tx?.description || 'Transaction'}>
    {tx && <div className="stack gap-18">
      <strong className={`detail-amount tx-amount ${tx.type}`}>{tx.type === 'income' ? '+' : tx.type === 'expense' ? '-' : ''}{fmt(tx.amount)}</strong>
      <p className="detail-kind">{tx.is_opening_balance ? 'Opening balance' : tx.type === 'income' ? 'Income' : tx.type === 'transfer' ? 'Transfer' : 'Expense'}</p>
      {tx.recorded_by_name && <p className="muted">Added by {tx.recorded_by_name}</p>}
      <dl className="transaction-details"><div><dt>Wallet</dt><dd>{tx.wallet_name || tx.shared_wallet_names?.join(' / ')}</dd></div>{tx.transfer_wallet_name && <div><dt>To wallet</dt><dd>{tx.transfer_wallet_name}</dd></div>}<div><dt>Category</dt><dd>{tx.category_name || (tx.type === 'transfer' ? 'Transfer' : 'Uncategorized')}</dd></div><div><dt>Recorded</dt><dd>{format(displayDate(tx.date), 'dd MMM yyyy, HH:mm')}</dd></div>{tx.owner_name && <div><dt>Wallet owner</dt><dd>{tx.owner_name}</dd></div>}{tx.recurring_frequency !== 'none' && tx.recurring_frequency && <div><dt>Repeat</dt><dd>{tx.recurring_frequency}{tx.recurring_until ? ` until ${tx.recurring_until}` : ' (set an end date when editing)'}</dd></div>}</dl>
      {tx.notes && <p className="transaction-note">{tx.notes}</p>}
      <button className="button ghost" onClick={() => { onClose(); navigate('/ask-ai', { state: { question: `Explain transaction #${tx.id}: ${tx.description}.`, scope: tx.shared_wallet_names ? 'shared' : 'personal', walletId: tx.shared_wallet_names ? tx.shared_wallet_ids?.[0] || tx.wallet_id : tx.wallet_id, month: tx.date.slice(0, 7) } }) }}><Sparkles size={17}/>Ask Budgetly about this</button>
      {tx.is_opening_balance ? <p className="form-note">This is the amount held when the wallet was created. The wallet owner can adjust it in Wallets.</p> : <div className="modal-actions">{onDuplicate && <button className="button ghost" onClick={onDuplicate}><Copy size={16}/>Duplicate</button>}{onEdit && <button className="button ghost" onClick={onEdit}><Pencil size={16}/>Edit</button>}{onDelete && <button className="button ghost danger" onClick={onDelete}><Trash2 size={16}/>Delete</button>}</div>}
    </div>}
  </Modal>
}
