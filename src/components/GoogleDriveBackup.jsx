import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronRight, Cloud, Download, ExternalLink, RefreshCw, Unplug, Upload, X } from 'lucide-react'
import { api, apiFile, jsonBody } from '../lib/api'
import { saveDownload } from '../lib/download'
import { openGoogleFlow, reserveGoogleWindow } from '../lib/googleFlow'
import { useConfirmation } from './Confirmation'

const base = '/api/google-drive'
const cancelFlow = (controller, abort = true) => {
  if (abort) controller?.abort()
  controller?.popup?.close()
  if (controller?.flow) {
    void api(`${base}/cancel`, { method: 'POST', ...jsonBody(controller.flow) }).catch(() => {})
    controller.flow = null
  }
}
const timestamp = value => {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString()
}

export default function GoogleDriveBackup() {
  const [expanded, setExpanded] = useState(false)
  const [status, setStatus] = useState(null)
  const [files, setFiles] = useState([])
  const [nextPage, setNextPage] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const operation = useRef(null)
  const mounted = useRef(true)
  const { confirm, confirmation } = useConfirmation()

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; cancelFlow(operation.current) }
  }, [])

  const load = useCallback(async signal => {
    const next = await api(`${base}/status`, { signal })
    if (signal.aborted || !mounted.current) return
    setStatus(next)
    if (next.connected) {
      const result = await api(`${base}/files`, { signal })
      if (!signal.aborted && mounted.current) {
        setFiles(result.files || [])
        setNextPage(result.nextPageToken || result.next_page_token || '')
      }
    } else { setFiles([]); setNextPage('') }
  }, [])

  const act = useCallback(async (kind, task) => {
    if (operation.current) return
    const controller = new AbortController()
    operation.current = controller
    setBusy(kind)
    setError('')
    setMessage('')
    try { await task(controller.signal) }
    catch (failure) {
      if (!controller.signal.aborted && mounted.current) setError(failure.message || 'Google Drive request failed. Please try again.')
    } finally {
      if (operation.current === controller) {
        operation.current = null
        if (mounted.current) setBusy('')
      }
    }
  }, [])

  useEffect(() => {
    if (expanded) void act('reload', load)
  }, [expanded, act, load])

  const connect = () => {
    if (operation.current) return
    let popup
    try { popup = reserveGoogleWindow() }
    catch (failure) { setError(failure.message); return }
    return act('connect', async signal => {
    const controller = operation.current
    controller.popup = popup
    try {
      const flow = await api(`${base}/start`, { method: 'POST' })
      controller.flow = { flow_id: flow.flow_id, poll_secret: flow.poll_secret }
      if (signal.aborted) { cancelFlow(controller); return }
      const result = await openGoogleFlow(flow, {
        popup, signal, pollPath: `${base}/poll`,
        pollBody: controller.flow,
      })
      if (result.status !== 'connected') throw new Error(result.message || 'Google Drive connection was not completed. Please try again.')
      controller.flow = null
    } finally { popup?.close(); if (controller.flow) cancelFlow(controller, false) }
    if (signal.aborted || !mounted.current) return
    await load(signal)
    if (!signal.aborted && mounted.current) setMessage('Google Drive connected.')
    })
  }

  const cancel = () => {
    cancelFlow(operation.current)
    operation.current = null
    setBusy('')
    setMessage('Connection waiting cancelled. Reload to check the connection.')
  }

  const backup = () => act('backup', async signal => {
    await api(`${base}/backup`, { method: 'POST', signal })
    if (signal.aborted || !mounted.current) return
    setMessage('Backup saved to Google Drive.')
    await load(signal)
  })

  const download = file => act(`download:${file.id}`, async signal => {
    const blob = await apiFile(`${base}/files/${encodeURIComponent(file.id)}/download`)
    if (signal.aborted || !mounted.current) return
    const name = (file.name || 'budgetly-backup.json').replace(/[\\/\u0000-\u001f]/g, '_')
    await saveDownload(blob, /\.json$/i.test(name) ? name : `${name}.json`)
    if (!signal.aborted && mounted.current) setMessage('Backup downloaded.')
  })

  const disconnect = () => act('disconnect', async signal => {
    if (!await confirm('Disconnect Google Drive? Existing backups in Drive will be kept.')) return
    if (signal.aborted || !mounted.current) return
    await api(`${base}/disconnect`, { method: 'POST', signal })
    if (signal.aborted || !mounted.current) return
    await load(signal)
    if (!signal.aborted && mounted.current) setMessage('Google Drive disconnected.')
  })

  const configured = status?.configured !== false
  const connected = Boolean(status?.connected)
  const stateLabel = !status ? 'Connection not checked' : !configured ? 'Not configured' : connected ? 'Connected' : 'Disconnected'

  return <>
    <details className="ledger-disclosure" onToggle={event => setExpanded(event.currentTarget.open)}>
      <summary>Google Drive (optional)</summary>
      <div className="stack gap-12" aria-busy={Boolean(busy)}>
        <div className="section-row">
          <div className="button-row"><Cloud size={18} aria-hidden="true"/><strong>{stateLabel}</strong></div>
          <button type="button" className="icon-button" title="Reload Google Drive connection" aria-label="Reload Google Drive connection" disabled={Boolean(busy)} onClick={() => act('reload', load)}><RefreshCw size={18}/></button>
        </div>
        {connected && status.email && <p className="muted" style={{ overflowWrap: 'anywhere' }}>{status.email}</p>}
        {status && !configured && <p className="muted">Google Drive backups are unavailable until Google integration is configured.</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div role="status" aria-live="polite">
          {busy === 'connect' ? <p className="muted">Waiting for Google authorization...</p> : busy === 'reload' ? <p className="muted">Checking Google Drive...</p> : message && <p className="muted">{message}</p>}
        </div>
        {busy === 'connect' ? <button type="button" className="button ghost self-start" onClick={cancel}><X size={18}/>Cancel waiting</button> : status && configured && !connected && <button type="button" className="button ghost self-start" disabled={Boolean(busy)} onClick={connect}><ExternalLink size={18}/>Connect Google Drive</button>}
        {connected && <>
          <div className="button-row">
            <button type="button" className="button primary" disabled={Boolean(busy)} onClick={backup}><Upload size={18}/>{busy === 'backup' ? 'Saving backup...' : 'Back up now'}</button>
            <button type="button" className="button ghost" disabled={Boolean(busy)} onClick={disconnect}><Unplug size={18}/>{busy === 'disconnect' ? 'Disconnecting...' : 'Disconnect'}</button>
          </div>
          <h4>Drive backups</h4>
          {files[0]&&<p className="muted">Latest saved backup: {timestamp(files[0].createdTime||files[0].created_at||files[0].modifiedTime)||'Date unavailable'}</p>}
          {!files.length ? <p className="muted">No backups in Google Drive yet.</p> : <div>{files.map(file => <div className="google-backup-row" key={file.id}>
            <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}><strong>{file.name || 'JSON backup'}</strong><small>{timestamp(file.createdTime || file.created_at || file.modifiedTime)}</small></div>
            <button type="button" className="icon-button" style={{ flexShrink: 0 }} title="Download JSON backup" aria-label={`Download ${file.name || 'JSON backup'}`} disabled={Boolean(busy)} onClick={() => download(file)}><Download size={18}/></button>
          </div>)}</div>}
          {nextPage && <button type="button" className="button ghost self-start" disabled={Boolean(busy)} onClick={() => act('more', async signal => {
            const result = await api(`${base}/files?page_token=${encodeURIComponent(nextPage)}`, { signal })
            if (signal.aborted || !mounted.current) return
            setFiles(current => [...current, ...(result.files || []).filter(file => !current.some(existing => existing.id === file.id))])
            setNextPage(result.nextPageToken || result.next_page_token || '')
          })}><ChevronRight size={18}/>{busy === 'more' ? 'Loading...' : 'Load more backups'}</button>}
        </>}
      </div>
    </details>
    {confirmation}
  </>
}
