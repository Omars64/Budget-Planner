import { useEffect, useState } from 'react'
import { useApp } from '../App'
import { api } from '../lib/api'
import { bankInboxChanged } from '../lib/bankNotifications/native'

export default function BankInboxBadge() {
  const { user, isGuest, spaceKey, refreshKey } = useApp()
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (isGuest) return
    let alive = true
    const load = () => { void api('/api/bank-inbox/stats').then(result => { if (alive) setCount(result.pending) }).catch(() => { if (alive) setCount(0) }) }
    load(); window.addEventListener(bankInboxChanged, load)
    return () => { alive = false; window.removeEventListener(bankInboxChanged, load) }
  }, [user.id, isGuest, spaceKey, refreshKey])
  return !isGuest && count > 0 ? <small className="bank-inbox-badge" aria-label={`${count} bank alerts pending`}>{count}</small> : null
}
