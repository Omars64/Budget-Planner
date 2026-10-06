const collections = {
  wallets: 'Wallets', categories: 'Categories', transactions: 'Transactions',
  planned_transactions: 'Scheduled transactions', budgets: 'Budgets', goals: 'Goals',
  debts: 'Debts', notes: 'Notes', note_folders: 'Note folders', wallet_shares: 'Wallet shares',
  balance_checks: 'Balance checks',
  receipts: 'Receipts',
}

export function backupPreview(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.version !== 1) {
    throw new Error('Choose a supported Budgetly JSON backup.')
  }
  const counts = Object.entries(collections).map(([key, label]) => {
    const rows = Object.hasOwn(data, key) ? data[key] : []
    if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
      throw new Error(`Backup contains invalid ${label.toLowerCase()}.`)
    }
    return { key, label, count: rows.length }
  })
  return counts
}
