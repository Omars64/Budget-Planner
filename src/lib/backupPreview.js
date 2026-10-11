const collections = {
  spaces: 'Spaces',
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
  if (['settings', 'wallets', 'categories', 'transactions', 'budgets', 'goals', 'debts'].some(key => !Object.hasOwn(data, key))) {
    throw new Error('This backup is incomplete. Choose a full Budgetly backup.')
  }
  const counts = Object.entries(collections).map(([key, label]) => {
    const rows = Object.hasOwn(data, key) ? data[key] : []
    if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
      throw new Error(`Backup contains invalid ${label.toLowerCase()}.`)
    }
    return { key, label, count: rows.length }
  })
  for (const space of data.spaces || []) {
    if (typeof space.name !== 'string' || !Array.isArray(space.members) ||
        (space.members || []).some(member => !member || typeof member.email !== 'string' ||
          !['view', 'add', 'edit'].includes(member.role))) {
      throw new Error('Backup contains invalid Space access details.')
    }
  }
  return counts
}
