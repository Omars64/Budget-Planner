import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { showTime } from '../lib/time'

export default function LegacyBankMessages() {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    api('/api/bank-messages').then(value => { if (alive) setRows(value) }).catch(failure => { if (alive) setError(failure.message) })
    return () => { alive = false }
  }, [])
  return <div className="stack gap-16">
    {error ? <p role="alert">{error}</p> : rows === null ? <p role="status">Loading saved messages...</p> : !rows.length ? <p className="muted">No saved messages.</p> : rows.map(row => <article key={row.id} className="bank-message"><strong>{row.bank}</strong><small>{showTime(row.created_at)}</small><p>{row.message}</p></article>)}
  </div>
}
