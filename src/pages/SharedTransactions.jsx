import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { ArrowDownLeft, ArrowRightLeft, ArrowUpRight, History, MailPlus, Trash2, Users, Wallet } from 'lucide-react'
import { format } from 'date-fns'
import { dateInput, saveDate, displayDate, showTime } from '../lib/time'
import { transactionErrors, focusInvalid } from '../lib/transactionForm'
import SearchableSelect from '../components/SearchableSelect'
import TransactionTemplates from '../components/TransactionTemplates'
import { readDraft, writeDraft, clearDraft } from '../lib/transactionDraft'
import { api, jsonBody, money, readCached } from '../lib/api'
import { useApp } from '../App'
import EmptyState from '../components/EmptyState'
import Modal from '../components/Modal'
import DateTimeField from '../components/DateTimeField'
import LedgerFilters, { defaultLedgerFilters } from '../components/LedgerFilters'
import LedgerPagination from '../components/LedgerPagination'
import useLedger from '../lib/useLedger'
import LedgerRow, { LedgerDateHeader, TransactionDetails } from '../components/LedgerRow'
import VoiceInputButton from '../components/VoiceInputButton'
import { parseVoiceTransaction, applyVoiceTransaction } from '../lib/voiceInput'
import { useViewState } from '../lib/viewState'
import BalancePreview from '../components/BalancePreview'
import { transactionSaved } from '../lib/savedFeedback'
import AnimatedMoney from '../components/AnimatedMoney'

const nowLocal = () => {
  return dateInput()
}

const blankTx = walletId => ({
  type: 'expense', amount: '', description: '', notes: '', date: nowLocal(),
  wallet_id: walletId || '', transfer_wallet_id: '', category_id: '',
  recurring_frequency: 'none', recurring_until: null,
})

export default function SharedTransactions() {
  const location = useLocation()
  const { user, settings, refreshKey, refresh, notify ,confirm} = useApp()
  const draftKey = `flowbudget_shared_tx_draft_${user?.id}`
  const [sharedWallets, setSharedWallets] = useState(() => readCached('/api/shared/wallets') || [])
  const [personalWallets, setPersonalWallets] = useState(() => (readCached('/api/wallets') || []).filter(w => !w.archived))
  const [filters, setFilters] = useViewState(`shared:${user?.id}:filters`, defaultLedgerFilters, location.state?.aiFilters ? {...defaultLedgerFilters,...location.state.aiFilters} : undefined)
  useEffect(() => { if (location.state?.aiFilters) setFilters({...defaultLedgerFilters,...location.state.aiFilters}) }, [location.key])
  const ledger = useLedger('/api/shared/transactions', filters, refreshKey, true, `shared:${user?.id}`)
  const { rows, loading } = ledger
  const walletFilter = filters.wallet
  const [syncError, setSyncError] = useState('')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const [share, setShare] = useState({ wallet_id: '', email: '', permission: 'view' })
  const [sharing, setSharing] = useState(false)
  const [activity,setActivity] = useState(null)
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [draft, setDraft] = useState(blankTx(''))
  const [categories, setCategories] = useState([])
  const [filterCategories, setFilterCategories] = useState([])
  const [saving, setSaving] = useState(false)
  const [voiceActive, setVoiceActive] = useState(false)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const [selected, setSelected] = useState(null)
  const [formError, setFormError] = useState('')
  const [errors, setErrors] = useState({})
  const savingRef = useRef(false)
  useEffect(() => {
    if (modal && !editing && !saving) writeDraft(draftKey,draft)
  }, [draft, modal, editing, saving, draftKey])

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
    const controller = new window.AbortController()
    api(`/api/shared/wallets/${draft.wallet_id}/categories`,{signal:controller.signal}).then(rows => {if(!controller.signal.aborted)setCategories(rows)}).catch(() => {if(!controller.signal.aborted)setCategories([])})
    return () => controller.abort()
  }, [draft.wallet_id])

  const sharedWalletKey = sharedWallets.map(w => w.wallet_id).sort((a,b) => a-b).join(',')
  useEffect(() => {
    const controller = new window.AbortController()
    const ids = sharedWalletKey ? sharedWalletKey.split(',') : []
    Promise.all(ids.map(id => api(`/api/shared/wallets/${id}/categories`, {signal:controller.signal}).then(rows => rows.map(c => ({...c, wallet_id:id, owner_name:sharedWallets.find(w => String(w.wallet_id) === id)?.owner_name}))))).then(groups => {
      if (!controller.signal.aborted) setFilterCategories(groups.flat())
    }).catch(() => { if (!controller.signal.aborted) setFilterCategories([]) })
    return () => controller.abort()
  }, [sharedWalletKey, refreshKey])

  const editableWallets = useMemo(() => sharedWallets.filter(w => editing ? w.can_edit : w.can_add), [sharedWallets,editing])
  const sourceWallet = sharedWallets.find(w => String(w.wallet_id) === String(draft.wallet_id))
  const transferWallets = editableWallets.filter(w => w.wallet_id !== Number(draft.wallet_id) && w.owner_email === sourceWallet?.owner_email)
  const filteredCategories = categories.filter(c => c.kind === draft.type)
  const changeWallet = value => {
    const next = sharedWallets.find(w => String(w.wallet_id) === String(value))
    const sameOwner = next?.owner_email === sourceWallet?.owner_email
    setDraft(current => ({ ...current, wallet_id: value,
      category_id: sameOwner ? current.category_id : '',
      transfer_wallet_id: sameOwner && String(current.transfer_wallet_id) !== String(value) ? current.transfer_wallet_id : '',
    }))
  }
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
    setErrors({})
    if (!sharedWallets.some(w => w.can_add)) { notify('You need add or edit access to a shared wallet first.', 'error'); return }
    setFormError('')
    const available = sharedWallets.filter(w => w.can_add)
    const walletId = available.find(w => String(w.wallet_id) === walletFilter)?.wallet_id || available[0]?.wallet_id || ''
    const restored = readDraft(draftKey)
    const reusable = restored && available.some(w => String(w.wallet_id) === String(restored.wallet_id))
    setEditing(null); setDraft(reusable ? {...blankTx(walletId),...restored} : blankTx(walletId)); setModal(true)
  }

  const openNewRef = useRef(openNew)
  openNewRef.current = openNew
  useEffect(() => {
    const open = () => openNewRef.current()
    window.addEventListener('budgetly:add-shared-transaction', open)
    return () => window.removeEventListener('budgetly:add-shared-transaction', open)
  }, [])

  const openEdit = tx => {
    setErrors({})
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
    if (savingRef.current || voiceActive) return
    const invalid = transactionErrors(draft)
    setErrors(invalid)
    if (Object.keys(invalid).length) { setFormError(Object.values(invalid)[0]); focusInvalid(e.currentTarget); return }
    savingRef.current = true; setSaving(true); setFormError('')
    try {
      const payload = {
        ...draft,
        description: draft.description.trim() || filteredCategories.find(c => String(c.id) === String(draft.category_id))?.name || (draft.type === 'income' ? 'Income' : draft.type === 'transfer' ? 'Transfer' : 'Expense'),
        revision: editing?.revision,
        amount: Number(draft.amount),
        wallet_id: Number(draft.wallet_id),
        transfer_wallet_id: draft.type === 'transfer' && draft.transfer_wallet_id ? Number(draft.transfer_wallet_id) : null,
        category_id: draft.type !== 'transfer' && draft.category_id ? Number(draft.category_id) : null,
        date: saveDate(draft.date),
        recurring_frequency: 'none', recurring_until: null,
      }
      const path = editing ? `/api/shared/transactions/${editing.id}` : '/api/shared/transactions'
      const saved = await api(path, { method: editing ? 'PUT' : 'POST', ...jsonBody(payload) })
      if (!editing) clearDraft(draftKey)
      transactionSaved(saved)
      setModal(false); setEditing(null); refresh(); notify(editing ? 'Shared transaction updated' : 'Shared transaction added')
    } catch (err) { setFormError(err.status === 409 ? 'Someone changed this record. Your edits are still here. Close and reopen the record to review the latest version before applying them.' : err.message) }
    finally { savingRef.current = false; setSaving(false) }
  }

  const applyVoice = async (transcript, {signal}) => {
    const preliminary = parseVoiceTransaction(transcript, {wallets:editableWallets,current:draftRef.current})
    const walletId = preliminary.wallet_id || draftRef.current.wallet_id
    const walletCategories = await api(`/api/shared/wallets/${walletId}/categories`, {signal})
    if (signal.aborted) return
    if (!preliminary.wallet_id && String(walletId) !== String(draftRef.current.wallet_id)) {
      setFormError('The shared wallet changed while applying voice input. Please try again.'); return
    }
    const result = applyVoiceTransaction(transcript,draftRef.current,{wallets:editableWallets,categories:walletCategories,shared:true})
    setDraft(result.draft)
    setCategories(walletCategories)
    setFormError(result.issues.join(' ') || (result.changed ? '' : 'No transaction fields recognized. Please try again.'))
    if (result.changed) notify('Voice applied. Review the shared transaction before saving.')
  }

  const removeTx = async tx => {
    if (!await confirm(`Delete “${tx.description}”? This affects everyone sharing the wallet.`)) return
    try {
      const result = await api(`/api/shared/transactions/${tx.id}?undo=true`, { method: 'DELETE' }); setSelected(null); refresh()
      notify(result?.trash_id ? 'Shared transaction moved to Trash' : 'Deleted. The wallet owner can restore this from Trash.', 'success', result?.trash_id ? {label:'Undo',run:async()=>{await api(`/api/trash/${result.trash_id}/restore`,{method:'POST'});refresh();notify('Transaction restored')}} : null)
    }
    catch (err) { notify(err.message, 'error') }
  }

  return <div className="ledger-page stack">
    <LedgerFilters value={filters} onChange={setFilters} wallets={sharedWallets} categories={filterCategories} shared><button className="button ghost small" data-tour="manage-sharing" onClick={() => setManageOpen(true)}><Users size={18}/>Manage</button></LedgerFilters>
    {(syncError || ledger.error) && <div className="form-error" role="alert">{syncError || ledger.error}<button className="button ghost small" onClick={refresh}>Retry</button></div>}
    {ledger.error && ledger.updatedAt && <small className="muted">Showing records last updated at {new Date(ledger.updatedAt).toLocaleTimeString()}.</small>}


    <section className="shared-ledger-wallets">
      <Modal open={manageOpen} onClose={() => setManageOpen(false)} title="Manage shared wallets">
        <button className="button ghost" onClick={() => {setManageOpen(false);setInviteOpen(true)}}><MailPlus size={18}/>Share a wallet</button>
        {sharedWallets.map(wallet => <section key={wallet.wallet_id} className="shared-management"><h4>{wallet.name}</h4><p className="muted">{wallet.is_owner ? 'Owner' : wallet.can_edit ? 'Can add, edit and delete' : wallet.can_add ? 'Can add' : 'Can view'}</p>
          <button className="button ghost small" onClick={async()=>{try{setActivity(await api(`/api/shared/wallets/${wallet.wallet_id}/activity`))}catch(e){notify(e.message,'error')}}}><History size={16}/>Activity</button>
          {wallet.is_owner && wallet.shares?.map(member => <div className="security-item" key={member.id}><span>{member.email}<small>{member.permission} · {member.registered ? 'Active' : 'Pending signup'}</small></span><button className="icon-button" aria-label={`Remove ${member.email}`} onClick={() => revoke(member)}><Trash2 size={16}/></button></div>)}
        </section>)}
      </Modal>
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
            <div className="shared-wallet-title"><div><span className="wallet-label"><Wallet size={15}/>{wallet.name}</span><strong className="shared-balance"><AnimatedMoney value={wallet.balance} currency={settings.currency} compact={settings.compact_numbers}/></strong></div></div>
            <small className="shared-owner">{wallet.is_owner ? 'Owned by you' : `Owned by ${wallet.owner_name || wallet.owner_email}`}</small>
            <small>{wallet.is_owner ? 'Owner' : wallet.can_edit ? 'Can add, edit and delete' : wallet.can_add ? 'Can add' : 'Can view'}</small>
          </div>)}
        </div>}
      </div>
    </section>



    <section className="ledger-list">
      <div className="ledger-count">{rows.length}{ledger.hasMore ? '+' : ''} transaction{rows.length === 1 ? '' : 's'}</div>
      {loading && !rows.length ? <div className="list-skeleton"><i/><i/><i/></div> : !rows.length ? <EmptyState title={syncError ? 'Activity unavailable' : 'No shared transactions'} text={syncError ? 'Try again when your connection recovers.' : 'Shared-wallet activity will appear here.'}/> : <div className="date-groups">
        {Object.entries(grouped).map(([day, txs]) => <div className="date-group" key={day}>
          <LedgerDateHeader day={day}/>
          {txs.map(tx => <LedgerRow key={tx.id} tx={tx} fmt={fmt} shared onOpen={() => setSelected(tx)}/> )}
        </div>)}
      </div>}
      <LedgerPagination ledger={ledger}/>
    </section>

    <TransactionDetails tx={selected} fmt={fmt} onClose={() => setSelected(null)} onEdit={selected?.can_edit ? () => {openEdit(selected);setSelected(null)} : undefined} onDelete={selected?.can_edit ? () => removeTx(selected) : undefined}/>
    <Modal open={activity!==null} onClose={()=>setActivity(null)} title="Wallet activity"><div className="security-items">{activity?.length?activity.map(a=><div className="security-item" key={a.id}><div><strong>{a.action}</strong><small>{a.actor} · {showTime(a.created_at)} Kuwait</small></div></div>):<p className="muted">No activity recorded yet.</p>}</div></Modal>
    <Modal open={modal} onClose={() => !saving && setModal(false)} title={editing ? 'Edit shared transaction' : 'Add shared transaction'}>
      <form className="stack gap-18 transaction-form" noValidate onSubmit={saveTx}>
        <fieldset className="transaction-fields stack gap-18" disabled={saving}>
        <div className="segment-control three"><button type="button" className={draft.type==='expense'?'active':''} onClick={() => setDraft({ ...draft, type:'expense', transfer_wallet_id:'', category_id:'' })}><ArrowUpRight size={17}/>Expense</button><button type="button" className={draft.type==='income'?'active':''} onClick={() => setDraft({ ...draft, type:'income', transfer_wallet_id:'', category_id:'' })}><ArrowDownLeft size={17}/>Income</button><button type="button" className={draft.type==='transfer'?'active':''} onClick={() => setDraft({ ...draft, type:'transfer', category_id:'' })}><ArrowRightLeft size={17}/>Transfer</button></div>
        <VoiceInputButton disabled={saving || !modal} onActiveChange={setVoiceActive} onTranscript={applyVoice} onError={message => setFormError(message)}/>
        {!editing && <TransactionTemplates userId={user?.id} scope="shared" draft={draft} disabled={saving} onApply={item => {
          const wallet = editableWallets.find(w => String(w.wallet_id) === String(item.wallet_id))
          if (!wallet) { setFormError('This template wallet is no longer available with add access.'); return }
          const category = filterCategories.find(c=>String(c.wallet_id)===String(wallet.wallet_id) && String(c.id)===String(item.category_id) && c.kind===item.type)
          setDraft(current => ({...current,type:item.type,amount:item.amount,description:item.description,wallet_id:wallet.wallet_id,transfer_wallet_id:editableWallets.some(w=>String(w.wallet_id)===String(item.transfer_wallet_id) && w.owner_email===wallet.owner_email) ? item.transfer_wallet_id : '',category_id:category?.id || ''}))
          setErrors({}); setFormError('')
        }}/>}
        <label className="amount-input"><span>Amount ({settings.currency})</span><input aria-label="Amount" aria-invalid={Boolean(errors.amount)} aria-describedby={errors.amount ? 'shared-amount-error' : undefined} required min="0.001" step="0.001" type="number" placeholder="0.000" value={draft.amount} onChange={e => {setDraft({ ...draft, amount: e.target.value });setErrors(v=>({...v,amount:''}))}}/></label>
        {errors.amount && <small id="shared-amount-error" className="field-error">{errors.amount}</small>}
        <label className="field"><span>Description</span><input maxLength="160" placeholder="What was this for?" value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })}/></label>
        <DateTimeField value={draft.date} onChange={date => setDraft(current => ({ ...current, date }))} disabled={saving}/>
        {errors.date && <small className="field-error">{errors.date}</small>}
        <div className="form-grid two transaction-wallet-fields">
          <SearchableSelect label="Shared wallet" value={draft.wallet_id} onChange={changeWallet} disabled={saving} error={errors.wallet_id} recentKey={`budgetly:recent:${user?.id}:shared-wallets`} options={editableWallets.map(w=>({value:w.wallet_id,label:`${w.name} · ${w.owner_name || w.owner_email}`}))}/>
          {draft.type === 'transfer' ? <SearchableSelect label="Destination shared wallet" value={draft.transfer_wallet_id} onChange={v=>setDraft({...draft,transfer_wallet_id:v})} disabled={saving} error={errors.transfer_wallet_id} options={transferWallets.map(w=>({value:w.wallet_id,label:w.name}))}/> : <SearchableSelect label="Category" value={draft.category_id} onChange={v=>setDraft({...draft,category_id:v})} placeholder="Uncategorized" disabled={saving} recentKey={`budgetly:recent:${user?.id}:shared-categories`} options={filteredCategories.map(c=>({value:c.id,label:c.name}))}/>}
        </div>
        {editing && String(editing.wallet_id) !== String(draft.wallet_id) && <p className="form-note">Saving moves this record and updates both wallet balances.{editing.owner_email !== sourceWallet?.owner_email ? ' Choose a category belonging to this wallet.' : ''}</p>}
        <BalancePreview wallet={sourceWallet} draft={draft} editing={editing} currency={settings.currency}/>
        <details className="form-options"><summary>More options</summary>{!editing && <button className="button ghost small" type="button" disabled={saving || voiceActive} onClick={()=>{clearDraft(draftKey);setDraft(blankTx(editableWallets[0]?.wallet_id));setErrors({});setFormError('')}}>Discard draft</button>}<label className="field"><span>Notes</span><textarea rows="3" value={draft.notes} onChange={e => setDraft({ ...draft, notes: e.target.value })}/></label></details>
        {formError && <div className="form-error" role="alert">{formError}</div>}
        {draft.type === 'transfer' && !transferWallets.length && <div className="form-note">A shared transfer needs another editable wallet owned by the same person.</div>}
        <div className="modal-actions"><button type="button" className="button ghost" disabled={saving} onClick={() => setModal(false)}>Cancel</button><button className="button primary" disabled={saving || voiceActive}>{saving ? 'Saving…' : 'Save'}</button></div>
        </fieldset>
      </form>
    </Modal>
  </div>
}
