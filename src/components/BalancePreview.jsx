import { money } from '../lib/api'

export function balanceAfter(balance, walletId, draft, editing) {
  const impact = tx => {
    if (!tx) return 0
    const amount = Number(tx.amount) || 0
    return (String(tx.wallet_id) === String(walletId) ? (tx.type === 'income' ? amount : -amount) : 0)
      + (tx.type === 'transfer' && String(tx.transfer_wallet_id) === String(walletId) ? amount : 0)
  }
  return Number(balance || 0) - impact(editing) + impact(draft)
}
export default function BalancePreview({ wallet, draft, editing, currency }) {
  if (!wallet) return null
  return <div className="balance-preview"><span>Current: {money(wallet.balance,currency)}</span><strong>After: {money(balanceAfter(wallet.balance,wallet.id ?? wallet.wallet_id,draft,editing),currency)}</strong></div>
}
