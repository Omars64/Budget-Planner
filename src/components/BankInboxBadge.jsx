import { useApp } from '../App'

export default function BankInboxBadge() {
  const { bankInboxCount, isGuest } = useApp()
  return !isGuest && bankInboxCount > 0 ? <small className="bank-inbox-badge" aria-label={`${bankInboxCount} bank alerts pending`}>{bankInboxCount}</small> : null
}
