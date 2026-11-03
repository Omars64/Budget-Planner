export function balanceAfter(balance, walletId, draft, editing) {
  const impact = tx => {
    if (!tx) return 0
    const amount = Number(tx.amount) || 0
    return (String(tx.wallet_id) === String(walletId) ? (tx.type === 'income' ? amount : -amount) : 0)
      + (tx.type === 'transfer' && String(tx.transfer_wallet_id) === String(walletId) ? amount : 0)
  }
  return Number(balance || 0) - impact(editing) + impact(draft)
}
