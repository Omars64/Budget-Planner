import { useCallback, useEffect, useState } from 'react'
import { BellRing, RefreshCw, Trash2 } from 'lucide-react'
import { useApp } from '../App'
import { api, jsonBody } from '../lib/api'
import { BankNotifications, bankNotificationsAvailable, syncBankNotifications } from '../lib/bankNotifications/native'

export default function BankNotificationSetup() {
  const { user, spaces, activeSpace, notify } = useApp()
  const native = bankNotificationsAvailable()
  const [granted, setGranted] = useState(false), [apps, setApps] = useState([]), [allowed, setAllowed] = useState([]), [search, setSearch] = useState('')
  const [mappings, setMappings] = useState([]), [destination, setDestination] = useState(String(activeSpace?.id || 'personal')), [wallets, setWallets] = useState([])
  const [mapping, setMapping] = useState({ source_package: '', account_last4: '', wallet_id: '' })
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const load = useCallback(async () => {
    try {
      setMappings(await api('/api/bank-inbox/mappings'))
      if (native) {
        const [permission, selection, installed] = await Promise.all([BankNotifications.isNotificationAccessGranted(), BankNotifications.getAllowedPackages({ owner: String(user.id) }), BankNotifications.getInstalledCandidateApps()])
        setGranted(permission.granted); setAllowed(selection.packages); setApps(installed.apps.sort((a, b) => a.label.localeCompare(b.label)))
        if (selection.queueFull || selection.captureError) setError('Some alerts could not be captured. Sync queued alerts and check your bank for missed activity.')
      }
    } catch (failure) { setError(failure.message) }
  }, [native, user.id])
  useEffect(() => {
    void load()
    const resume = () => { if (document.visibilityState !== 'hidden') void load() }
    window.addEventListener('focus', resume); document.addEventListener('visibilitychange', resume)
    return () => { window.removeEventListener('focus', resume); document.removeEventListener('visibilitychange', resume) }
  }, [load])
  useEffect(() => {
    let live = true
    setWallets([]); setMapping(value => ({ ...value, wallet_id: '' }))
    api(`/api/wallets?space_id=${destination}`).then(rows => { if (live) setWallets(rows.filter(row => !row.archived)) }).catch(failure => { if (live) setError(failure.message) })
    return () => { live = false }
  }, [destination])
  async function act(task) {
    setBusy(true); setError('')
    try { await task() } catch (failure) { setError(failure.message) } finally { setBusy(false) }
  }
  const selectApp = (name, checked) => act(async () => {
    const packages = checked ? [...allowed, name] : allowed.filter(value => value !== name)
    await BankNotifications.setAllowedPackages({ owner: String(user.id), packages }); setAllowed(packages)
    if (checked) notify('Bank app enabled. New alerts wait for your approval.')
  })
  return <div className="stack gap-16 bank-setup">
    <p className="muted">Only selected apps are read. Nothing enters your ledger without approval. Security codes are discarded on your phone.</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    {native ? <>
      <div className="section-row"><strong>Notification access: {granted ? 'Enabled' : 'Disabled'}</strong><button type="button" className="icon-button" aria-label="Refresh bank access" onClick={load}><RefreshCw size={18}/></button></div>
      <button type="button" className="button ghost" onClick={() => act(() => BankNotifications.openNotificationAccessSettings())}><BellRing size={18}/>Open Android settings</button>
      <details className="bank-settings-disclosure"><summary>Apps to monitor · {allowed.length} selected</summary>
        <label className="field"><span>Find a banking or payment app</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search installed apps"/></label>
        <div className="bank-app-list">{apps.filter(app => `${app.label} ${app.packageName}`.toLowerCase().includes(search.toLowerCase())).map(app => <label className="check-row" key={app.packageName}><input type="checkbox" checked={allowed.includes(app.packageName)} disabled={busy} onChange={event => selectApp(app.packageName, event.target.checked)}/><span>{app.label}<small>{app.packageName}</small></span></label>)}</div>
        {!apps.length && <p className="muted">No launchable apps found. Install and open your banking app, then refresh.</p>}
      </details>
      <button type="button" disabled={busy} className="button ghost" onClick={() => act(async () => { await syncBankNotifications(user.id); notify('Queued alerts checked') })}><RefreshCw size={18}/>Check queued alerts</button>
    </> : <p className="muted">Automatic detection is available in the Android app. You can paste transaction messages in your browser.</p>}
    <details className="bank-settings-disclosure"><summary>Bank app & card → wallet · {mappings.length} mappings</summary>
      {mappings.map(row => <div className="section-row" key={row.id}><span>{apps.find(app => app.packageName === row.source_package)?.label || row.source_package} {row.account_last4 && `••••${row.account_last4}`} → {row.wallet_name}<small>{spaces.find(space => space.id === row.space_id)?.name || 'Personal'}</small></span><button type="button" className="icon-button" disabled={busy} aria-label={`Remove mapping for ${row.wallet_name}`} onClick={() => act(async () => { await api(`/api/bank-inbox/mappings/${row.id}`, { method: 'DELETE' }); await load() })}><Trash2 size={18}/></button></div>)}
      <form className="stack gap-12" onSubmit={event => { event.preventDefault(); void act(async () => { await api('/api/bank-inbox/mappings', { method: 'PUT', ...jsonBody({ ...mapping, wallet_id: Number(mapping.wallet_id) }) }); await load(); notify('Wallet mapping saved') }) }}>
        <label className="field"><span>Bank app</span>{native ? <select required value={mapping.source_package} onChange={event => setMapping({ ...mapping, source_package: event.target.value })}><option value="">Choose enabled app</option>{apps.filter(app => allowed.includes(app.packageName)).map(app => <option value={app.packageName} key={app.packageName}>{app.label}</option>)}</select> : <input required maxLength={180} value={mapping.source_package} onChange={event => setMapping({ ...mapping, source_package: event.target.value })} placeholder="manual.nbk"/>}</label>
        <label className="field"><span>Card/account last four (optional)</span><input inputMode="numeric" pattern="[0-9]{4}|" maxLength={4} value={mapping.account_last4} onChange={event => setMapping({ ...mapping, account_last4: event.target.value.replace(/\D/g, '').slice(0, 4) })}/></label>
        <div className="form-grid two"><label className="field"><span>Destination</span><select value={destination} onChange={event => setDestination(event.target.value)}><option value="personal">Personal</option>{spaces.filter(space => space.role !== 'view').map(space => <option key={space.id} value={space.id}>{space.name}</option>)}</select></label><label className="field"><span>Wallet</span><select required value={mapping.wallet_id} onChange={event => setMapping({ ...mapping, wallet_id: event.target.value })}><option value="">Choose wallet</option>{wallets.map(wallet => <option key={wallet.id} value={wallet.id}>{wallet.name}</option>)}</select></label></div>
        <button className="button primary" disabled={busy}>Save mapping</button>
      </form>
    </details>
  </div>
}
