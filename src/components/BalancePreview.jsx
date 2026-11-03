import { money } from '../lib/api'

import { balanceAfter } from '../lib/balancePreview'

export default function BalancePreview({ wallet, draft, editing, currency }) {
  if (!wallet) return null
  return <div className="balance-preview"><span>Current: {money(wallet.balance,currency)}</span><strong>After: {money(balanceAfter(wallet.balance,wallet.id ?? wallet.wallet_id,draft,editing),currency)}</strong></div>
}
