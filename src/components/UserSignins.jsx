import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import Modal from './Modal'
import './UserSignins.css'
import { signinTime } from '../lib/signinTime'

export default function UserSignins({ account, onClose }) {
  const [offset, setOffset] = useState(0)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!account) return
    const controller = new AbortController()
    setResult(null); setError('')
    api(`/api/admin/users/${account.id}/signins?offset=${offset}`, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setResult(value) })
      .catch(err => { if (!controller.signal.aborted) setError(err.message) })
    return () => controller.abort()
  }, [account, offset, retry])
  return <Modal open={!!account} onClose={onClose} title={`Sign-in history · ${account?.username || ''}`} subtitle="Recorded account sessions. Times use this device's timezone.">
    <p className="muted">Last active is the most recent recorded request, not a new sign-in. Device labels are approximate; location and IP addresses are not collected here.</p>
    {error ? <div role="alert" className="form-error">{error}<button className="button ghost" onClick={() => setRetry(value => value + 1)}>Retry</button></div>
      : !result ? <p role="status">Loading sign-in history...</p>
      : !result.items.length ? <p>No recorded sign-ins on this page.</p>
      : <div className="stack gap-16">{result.items.map((item, index) => <article className="signin-entry" key={`${offset}-${index}`}>
        <div className="panel-head"><strong>{item.device}</strong><span className="status-pill">{item.status}</span></div>
        <dl><div><dt>Signed in</dt><dd>{signinTime(item.signed_in_at)}</dd></div><div><dt>Last active</dt><dd>{signinTime(item.last_active_at)}</dd></div></dl>
      </article>)}</div>}
    <div className="modal-actions"><button className="button ghost" disabled={!offset || !result} onClick={() => setOffset(value => Math.max(0, value - 50))}>Previous</button><button className="button ghost" disabled={!result?.has_more} onClick={() => setOffset(value => value + 50)}>Next</button></div>
  </Modal>
}
