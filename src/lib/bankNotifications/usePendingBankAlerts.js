import { useEffect, useState } from 'react'
import { api } from '../api'
import { bankInboxChanged } from './native'

export default function usePendingBankAlerts(userId, spaceId) {
  const scope = userId ? `${userId}:${spaceId ?? 'personal'}` : null
  const [pending, setPending] = useState(null)
  useEffect(() => {
    if (!scope) return
    let request
    const load = async () => {
      request?.abort()
      const controller = new AbortController()
      request = controller
      try {
        const result = await api(`/api/bank-inbox/stats?space_id=${spaceId ?? 'personal'}`, { signal:controller.signal })
        if (!controller.signal.aborted) setPending({ scope, count:result.pending })
      } catch { /* Keep the last count for this workspace until it can refresh. */ }
    }
    void load()
    window.addEventListener(bankInboxChanged,load)
    window.addEventListener('online',load)
    return () => {
      request?.abort()
      window.removeEventListener(bankInboxChanged,load)
      window.removeEventListener('online',load)
    }
  },[scope,spaceId])
  return scope && pending?.scope === scope ? pending.count : 0
}
