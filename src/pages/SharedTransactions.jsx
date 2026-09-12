import { useEffect, useMemo, useRef, useState } from 'react'
import { History, MailPlus, Trash2, Users, Wallet } from 'lucide-react'
import { format } from 'date-fns'
import { dateInput, saveDate, displayDate, showTime } from '../lib/time'
import { api, jsonBody, money, readCached } from '../lib/api'
import { useApp } from '../App'
import EmptyState from '../components/EmptyState'
import Modal from '../components/Modal'
import LedgerFilters, { defaultLedgerFilters } from '../components/LedgerFilters'
import LedgerPagination from '../components/LedgerPagination'
import useLedger from '../lib/useLedger'
import LedgerRow, { TransactionDetails } from '../components/LedgerRow'

const nowLocal = () => {
  return dateInput()
}

const blankTx = walletId => ({
  type: 'expense', amount: '', description: '', notes: '', date: nowLocal(),
  wallet_id: walletId || '', transfer_wallet_id: '', category_id: '',
  recurring_frequency: 'none', recurring_until: null,
})

export default function SharedTransactions() {
  const { settings, refreshKey, refresh, notify ,confirm} = useApp()
  const [sharedWallets, setSharedWallets] = useState(() => readCached('/api/shared/wallets') || [])
  const [personalWallets, setPersonalWallets] = useState(() => (readCached('/api/wallets') || []).filter(w => !w.archived))
  const [filters, setFilters] = useState(defaultLedgerFilters)
  const ledger = useLedger('/api/shared/transactions', filters, refreshKey, true)
  const { rows, loading } = ledger
  const walletFilter = filters.wallet
  const [syncError, setSyncError] = useState('')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [share, setShare] = useState({ wallet_id: '', email: '', permission: 'view' })
  const [sharing, setSharing] = useState(false)
  const [activity,setActivity] = useState(null)
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [draft, setDraft] = useState(blankTx(''))
  const [categories, setCategories] = useState([])
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState(null)
  const [formError, setFormError] = useState('')
  const savingRef = useRef(false)

  const loadWallets = async () => {
    const [shared, personal] = await Promise.all([api('/api/shared/wallets'), api('/api/wallets')])
    setSharedWallets(shared)
    setPersonalWallets(personal.filter(w => !w.archived))
    setShare(current => ({ ...current, wallet_id: current.wallet_id || personal.find(w => !w.archived)?.id || '' }))
    return shared
  }

  useEffect(() => {
    const controller = new window.AbortController()
    let pending = false
    let reportedError = false
    const sync = async () => {
      if (pending || document.visibilityState === 'hidden') return
      pending = true
      try {
        const options = { signal: controller.signal }
        const results = await Promise.allSettled([
          api('/api/shared/wallets', options).then(wallets => { if (!controller.signal.aborted) setSharedWallets(wallets) }),
          api('/api/wallets', options).then(personal => { if (!controller.signal.aborted) { setPersonalWallets(personal.filter(w => !w.archived)); setShare(current => ({ ...current, wallet_id: current.wallet_id || personal.find(w => !w.archived)?.id || '' })) } }),
        ])
        const failed = results.find(result => result.status === 'rejected')
        if (failed) throw failed.reason
        setSyncError('')
        reportedError = false
      } catch (err) {
        if (!controller.signal.aborted && !reportedError) {
          setSyncError('Could not refresh shared activity. Your saved data has not been removed. ' + err.message)
          if (err.status === 401 || err.status === 403) { setSharedWallets([]) }
          reportedError = true
        }
      } finally {
        pending = false
      }
    }
    const timer = window.setTimeout(sync, 0)
    const interval = window.setInterval(sync, 5000)
    window.addEventListener('focus', sync)
    document.addEventListener('visibilitychange', sync)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
      window.clearInterval(interval)
      window.removeEventListener('focus', sync)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [refreshKey])

  useEffect(() => {
    if (!draft.wallet_id) { setCategories([]); return }
    api(`/api/shared/wallets/${draft.wallet_id}/categories`).then(setCategories).catch(() => setCategories([]))
  }, [draft.wallet_id])

  const editableWallets = useMemo(() => sharedWallets.filter(w => editing ? w.can_edit : w.can_add), [sharedWallets,editing])
  const sourceWallet = sharedWallets.find(w => String(w.wallet_id) === String(draft.wallet_id))
  const transferWallets = editableWallets.filter(w => w.wallet_id !== Number(draft.wallet_id) && w.owner_email === sourceWallet?.owner_email)
  const filteredCategories = categories.filter(c => c.kind === draft.type)
  const grouped = useMemo(() => rows.reduce((acc, tx) => {
    const key = format(displayDate(tx.date), 'yyyy-MM-dd'); (acc[key] ||= []).push(tx); return acc
  }, {}), [rows])
  const fmt = value => money(value, settings.currency, settings.compact_numbers)

  const submitShare = async e => {
    e.preventDefault(); setSharing(true)
    try {
      await api(`/api/shared/wallets/${share.wallet_id}/shares`, { method: 'POST', ...jsonBody({ email: share.email, permission: share.permission }) })
      setShare(v => ({ ...v, email: '' }))
      await loadWallets(); refresh(); notify('Wallet sharing updated')
    } catch (err) { notify(err.message, 'error') }
    finally { setSharing(false) }
  }

  const revoke = async item => {
    if (!await confirm(`Remove ${item.email} from this wallet?`)) return
    try { await api(`/api/shared/shares/${item.id}`, { method: 'DELETE' }); await loadWallets(); refresh(); notify('Access removed') }
    catch (err) { notify(err.message, 'error') }
  }

  const openNew = () => {
    if (!sharedWallets.some(w => w.can_add)) { notify('You need add or edit access to a shared wallet first.', 'error'); return }
    setFormError('')
    const walletId = editableWallets.find(w => String(w.wallet_id) === walletFilter)?.wallet_id || editableWallets[0]?.wallet_id || ''
    setEditing(null); setDraft(blankTx(walletId)); setModal(true)
  }

  useEffect(() => {
    window.addEventListener('budgetly:add-shared-transaction', openNew)
    return () => window.removeEventListener('budgetly:add-shared-transaction', openNew)
  }, [sharedWallets, walletFilter])

  const openEdit = tx => {
    setFormError('')
    setEditing(tx)
    setDraft({
      type: tx.type, amount: String(tx.amount), description: tx.description, notes: tx.notes || '',
      date: dateInput(tx.date), wallet_id: tx.wallet_id, transfer_wallet_id: tx.transfer_wallet_id || '',
      category_id: tx.category_id || '', recurring_frequency: 'none', recurring_until: null,
    })
    setModal(true)
  }

  const saveTx = async e => {
    e.preventDefault()
    if (savingRef.current) return
    if (!draft.description.trim()) { setFormError('Enter a description.'); return }
    if (!draft.wallet_id || !(Number(draft.amount) > 0) || !draft.date) { setFormError('Choose a wallet, an amount greater than zero, and a date.'); return }
    if (draft.type === 'transfer' && !draft.transfer_wallet_id) { setFormError('Choose a destination wallet.'); return }
    savingRef.current = true; setSaving(true); setFormError('')
    try {
      const payload = {
        ...draft,
        revision: editing?.revision,
        amount: Number(draft.amount),
        wallet_id: Number(draft.wallet_id),
        transfer_wallet_id: draft.type === 'transfer' && draft.transfer_wallet_id ? Number(draft.transfer_wallet_id) : null,
        category_id: draft.type !== 'transfer' && draft.category_id ? Number(draft.category_id) : null,
        date: saveDate(draft.date),
        recurring_frequency: 'none', recurring_until: null,
      }
      const path = editing ? `/api/shared/transactions/${editing.id}` : '/api/shared/transactions'
      await api(path, { method: editing ? 'PUT' : 'POST', ...jsonBody(payload) })
      setModal(false); setEditing(null); refresh(); notify(editing ? 'Shared transaction updated' : 'Shared transaction added')
    } catch (err) { setFormError(err.message) }
    finally { savingRef.current = false; setSaving(false) }
  }

  const removeTx = async tx => {
    if (!await confirm(`Delete “${tx.description}”? This affects everyone sharing the wallet.`)) return
    try { await api(`/api/shared/transactions/${tx.id}`, { method: 'DELETE' }); setSelected(null); refresh(); notify('Shared transaction deleted') }
    catch (err) { notify(err.message, 'error') }
  }

  return <div className="ledger-page stack">
    <LedgerFilters value={filters} onChange={setFilters} wallets={sharedWallets} shared><button className="icon-button" title="Share a wallet" aria-label="Share a wallet" onClick={() => setInviteOpen(true)}><MailPlus size={18}/></button></LedgerFilters>
    {(syncError || ledger.error) && <div className="form-error" role="alert">{syncError || ledger.error}<button className="button ghost small" onClick={refresh}>Retry</button></div>}


    <section className="shared-ledger-wallets">
      <Modal open={inviteOpen} onClose={() => setInviteOpen(false)} title="Share a wallet">
        <div className="panel-head"><div><p className="eyebrow">Share a wallet</p><h3>Invite by email</h3></div><MailPlus className="muted-icon"/></div>
        <form className="stack gap-12" onSubmit={submitShare}>
          <label className="field"><span>Wallet</span><select required value={share.wallet_id} onChange={e => setShare({ ...share, wallet_id: e.target.value })}><option value="">Choose a wallet</option>{personalWallets.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
          <label className="field"><span>User email</span><input required type="email" value={share.email} onChange={e => setShare({ ...share, email: e.target.value })} placeholder="person@example.com"/></label>
          <label className="field"><span>Permission</span><select value={share.permission} onChange={e => setShare({ ...share, permission: e.target.value })}><option value="view">Viewer</option><option value="add">Add only</option><option value="edit">Editor (add, edit, delete)</option></select></label>
          <button className="button primary self-start" disabled={sharing || !share.wallet_id || !share.email}>{sharing ? 'Sharing…' : 'Share wallet'}</button>
        </form>
      </Modal>

      <div className="shared-wallet-section">

        {!sharedWallets.length ? (loading ? <div className="list-skeleton"><i/><i/></div> : <EmptyState title={syncError ? 'Connection interrupted' : 'Nothing shared yet'} text={syncError ? 'Retry to load your wallets.' : 'Share a wallet or ask its owner for access.'}/>) : <div className="shared-wallet-list">
          {sharedWallets.filter(wallet => !walletFilter || String(wallet.wallet_id) === walletFilter).map(wallet => <div className="shared-wallet-card" key={wallet.wallet_id}>
            <div className="shared-wallet-title"><div><span className="wallet-label"><Wallet size={15}/>{wallet.name}</span><strong className="shared-balance">{fmt(wallet.balance)}</strong></div></div>
            <details className="ledger-disclosure"><summary><Users size={15}/> {wallet.is_owner ? 'Members & access' : 'Wallet access'}</summary><div className="shared-access-body"><p className="muted">{wallet.is_owner ? 'You own this wallet' : `Owned by ${wallet.owner_name || wallet.owner_email}`} &middot; {wallet.is_owner ? 'Owner' : wallet.permission === 'add' ? 'Add only' : wallet.can_edit ? 'Editor' : 'Viewer'}</p>
              <button className="button ghost small" onClick={async()=>{try{setActivity(await api(`/api/shared/wallets/${wallet.wallet_id}/activity`))}catch(e){notify(e.message,'error')}}}><History size={16}/>Activity</button>
              {wallet.is_owner && <div className="share-members">{wallet.shares?.map(member => <div key={member.id}><span><strong>{member.email}</strong><small>{member.permission === 'edit' ? 'Editor' : member.permission === 'add' ? 'Add only' : 'Viewer'} &middot; {member.registered ? 'Active user' : 'Pending signup'}</small></span><button className="row-icon danger" onClick={() => revoke(member)} aria-label={`Remove ${member.email}`}><Trash2/></button></div>)}</div>}
            </div></details>
          </div>)}
        </div>}
      </div>
    </section>



    <section className="ledger-list">
      <div className="ledger-count">{rows.length}{ledger.hasMore ? '+' : ''} transaction{rows.length === 1 ? '' : 's'}</div>
      {loading && !rows.length ? <div className="list-skeleton"><i/><i/><i/></div> : !rows.length ? <EmptyState title={syncError ? 'Activity unavailable' : 'No shared transactions'} text={syncError ? 'Try again when your connection recovers.' : 'Shared-wallet activity will appear here.'}/> : <div className="date-groups">
        {Object.entries(grouped).map(([day, txs]) => <div className="date-group" key={day}>
          <div className="date-label"><strong>{format(new Date(day+'T12:00:00'), 'EEEE')}</strong><span>{format(new Date(day+'T12:00:00'), 'dd MMM yyyy')}</span></div>
          {txs.map(tx => <LedgerRow key={tx.id} tx={tx} fmt={fmt} shared onOpen={() => setSelected(tx)}/> )}
        </div>)}
      </div>}
      <LedgerPagination ledger={ledger}/>
    </section>

    <TransactionDetails tx={selected} fmt={fmt} onClose={() => setSelected(null)} onEdit={selected?.can_edit ? () => {openEdit(selected);setSelected(null)} : undefined} onDelete={selected?.can_edit ? () => removeTx(selected) : undefined}/>
    <Modal open={activity!==null} onClose={()=>setActivity(null)} title="Wallet activity"><div className="security-items">{activity?.length?activity.map(a=><div className="security-item" key={a.id}><div><strong>{a.action}</strong><small>{a.actor} · {showTime(a.created_at)} Kuwait</small></div></div>):<p className="muted">No activity recorded yet.</p>}</div></Modal>
    <Modal open={modal} onClose={() => !saving && setModal(false)} title={editing ? 'Edit shared transaction' : 'Add shared transaction'}>
      <form className="stack gap-16 transaction-form" onSubmit={saveTx}>
        <label className="field"><span>Shared wallet</span><select required value={draft.wallet_id} onChange={e => setDraft({ ...draft, wallet_id: e.target.value, transfer_wallet_id: '', category_id: '' })}>{editableWallets.map(w => <option key={w.wallet_id} value={w.wallet_id}>{w.name} · {w.owner_name || w.owner_email}</option>)}</select></label>
        <div className="segment-control"><button type="button" className={draft.type==='expense'?'active':''} onClick={() => setDraft({ ...draft, type:'expense', transfer_wallet_id:'', category_id:'' })}>Expense</button><button type="button" className={draft.type==='income'?'active':''} onClick={() => setDraft({ ...draft, type:'income', transfer_wallet_id:'', category_id:'' })}>Income</button><button type="button" className={draft.type==='transfer'?'active':''} onClick={() => setDraft({ ...draft, type:'transfer', category_id:'' })}>Transfer</button></div>
        <label className="field"><span>Amount</span><input required min="0.001" step="0.001" type="number" value={draft.amount} onChange={e => setDraft({ ...draft, amount: e.target.value })}/></label>
        <label className="field"><span>Description</span><input required maxLength="160" value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })}/></label>
        <div className="form-grid two">
          <label className="field"><span>Date & time</span><input required type="datetime-local" value={draft.date} onChange={e => setDraft({ ...draft, date: e.target.value })}/></label>
          {draft.type === 'transfer' ? <label className="field"><span>Destination shared wallet</span><select required value={draft.transfer_wallet_id} onChange={e => setDraft({ ...draft, transfer_wallet_id: e.target.value })}><option value="">Choose destination</option>{transferWallets.map(w => <option key={w.wallet_id} value={w.wallet_id}>{w.name}</option>)}</select></label> : <label className="field"><span>Category</span><select value={draft.category_id} onChange={e => setDraft({ ...draft, category_id: e.target.value })}><option value="">Uncategorized</option>{filteredCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
        </div>
        <details className="form-options"><summary>More options</summary><label className="field"><span>Notes</span><textarea rows="3" value={draft.notes} onChange={e => setDraft({ ...draft, notes: e.target.value })}/></label></details>
        {formError && <div className="form-error" role="alert">{formError}</div>}
        {draft.type === 'transfer' && !transferWallets.length && <div className="form-note">A shared transfer needs another editable wallet owned by the same person.</div>}
        <div className="modal-actions"><button type="button" className="button ghost" onClick={() => setModal(false)}>Cancel</button><button className="button primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button></div>
      </form>
    </Modal>
  </div>
}
