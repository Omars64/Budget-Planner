const collections = {
  spaces: 'Spaces',
  wallets: 'Wallets', categories: 'Categories', transactions: 'Transactions',
  planned_transactions: 'Scheduled transactions', budgets: 'Budgets', goals: 'Goals',
  debts: 'Debts', notes: 'Notes', note_folders: 'Note folders', wallet_shares: 'Wallet shares',
  balance_checks: 'Balance checks',
  receipts: 'Receipts',
}

export function hasLegacySpaceCategories(data) {
  if (data?.recovery_compatibility?.legacy_space_category_links > 0) return true
  const categories = new Map((data?.categories || []).map(row => [row.id, row]))
  const wallets = new Map((data?.wallets || []).map(row => [row.id, row]))
  const spaces = new Set((data?.spaces || []).map(row => row.id))
  return ['transactions', 'planned_transactions', 'budgets'].some(name =>
    (data?.[name] || []).some(row => {
      const category = categories.get(row.category_id)
      const scope = name === 'budgets' ? row.space_id : wallets.get(row.wallet_id)?.space_id
      const kind = name === 'budgets' ? 'expense' : row.type
      return scope != null && spaces.has(scope) && category && category.space_id == null &&
        category.kind === kind && ['income', 'expense'].includes(kind)
    }))
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
