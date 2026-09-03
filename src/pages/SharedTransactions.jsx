import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowDownLeft, ArrowRightLeft, ArrowUpRight, Eye, MailPlus, Pencil, Plus, Search, Share2, Trash2, Users } from 'lucide-react'
import { format } from 'date-fns'
import { api, jsonBody, money } from '../lib/api'
import { useApp } from '../App'
import EmptyState from '../components/EmptyState'
import Modal from '../components/Modal'

const nowLocal = () => {
  const d = new Date()
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}

const blankTx = walletId => ({
  type: 'expense', amount: '', description: '', notes: '', date: nowLocal(),
  wallet_id: walletId || '', transfer_wallet_id: '', category_id: '',
  recurring_frequency: 'none', recurring_until: null,
})

export default function SharedTransactions() {
  const { settings, refreshKey, refresh, notify } = useApp()
  const [sharedWallets, setSharedWallets] = useState([])
  const [personalWallets, setPersonalWallets] = useState([])
  const [rows, setRows] = useState([])
  const [search, setSearch] = useState('')
  const [type, setType] = useState('all')
  const [walletFilter, setWalletFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [share, setShare] = useState({ wallet_id: '', email: '', permission: 'view' })
  const [sharing, setSharing] = useState(false)
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [draft, setDraft] = useState(blankTx(''))
  const [categories, setCategories] = useState([])
  const [saving, setSaving] = useState(false)

  const loadWallets = async () => {
    const [shared, personal] = await Promise.all([api('/api/shared/wallets'), api('/api/wallets')])
    setSharedWallets(shared)
    setPersonalWallets(personal.filter(w => !w.archived))
    setShare(current => ({ ...current, wallet_id: current.wallet_id || personal.find(w => !w.archived)?.id || '' }))
    return shared
  }

  const loadTransactions = async () => {
    const qs = new URLSearchParams({ search, tx_type: type })
    if (walletFilter) qs.set('wallet_id', walletFilter)
    try { setRows(await api(`/api/shared/transactions?${qs}`)) }
    finally { setLoading(false) }
  }

  useEffect(() => { loadWallets().catch(err => notify(err.message, 'error')) }, [refreshKey])
  useEffect(() => {
    setLoading(true)
    const timer = setTimeout(() => loadTransactions().catch(err => notify(err.message, 'error')), 160)
    return () => clearTimeout(timer)
  }, [search, type, walletFilter, refreshKey])

  useEffect(() => {
    if (!draft.wallet_id) { setCategories([]); return }
    api(`/api/shared/wallets/${draft.wallet_id}/categories`).then(setCategories).catch(() => setCategories([]))
  }, [draft.wallet_id])

  const editableWallets = useMemo(() => sharedWallets.filter(w => w.can_edit), [sharedWallets])
  const sourceWallet = sharedWallets.find(w => String(w.wallet_id) === String(draft.wallet_id))
  const transferWallets = editableWallets.filter(w => w.wallet_id !== Number(draft.wallet_id) && w.owner_email === sourceWallet?.owner_email)
  const filteredCategories = categories.filter(c => c.kind === draft.type)
  const grouped = useMemo(() => rows.reduce((acc, tx) => {
    const key = format(new Date(tx.date), 'yyyy-MM-dd'); (acc[key] ||= []).push(tx); return acc
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
    if (!confirm(`Remove ${item.email} from this wallet?`)) return
    try { await api(`/api/shared/shares/${item.id}`, { method: 'DELETE' }); await loadWallets(); refresh(); notify('Access removed') }
    catch (err) { notify(err.message, 'error') }
  }

  const openNew = () => {
    const walletId = editableWallets[0]?.wallet_id || ''
    setEditing(null); setDraft(blankTx(walletId)); setModal(true)
  }

  const openEdit = tx => {
    setEditing(tx)
    setDraft({
      type: tx.type, amount: String(tx.amount), description: tx.description, notes: tx.notes || '',
      date: String(tx.date).slice(0, 16), wallet_id: tx.wallet_id, transfer_wallet_id: tx.transfer_wallet_id || '',
      category_id: tx.category_id || '', recurring_frequency: 'none', recurring_until: null,
    })
    setModal(true)
  }

  const saveTx = async e => {
    e.preventDefault(); setSaving(true)
    try {
      const payload = {
        ...draft,
        amount: Number(draft.amount),
        wallet_id: Number(draft.wallet_id),
        transfer_wallet_id: draft.type === 'transfer' && draft.transfer_wallet_id ? Number(draft.transfer_wallet_id) : null,
        category_id: draft.type !== 'transfer' && draft.category_id ? Number(draft.category_id) : null,
        date: new Date(draft.date).toISOString(),
        recurring_frequency: 'none', recurring_until: null,
      }
      const path = editing ? `/api/shared/transactions/${editing.id}` : '/api/shared/transactions'
      await api(path, { method: editing ? 'PUT' : 'POST', ...jsonBody(payload) })
      setModal(false); setEditing(null); refresh(); notify(editing ? 'Shared transaction updated' : 'Shared transaction added')
    } catch (err) { notify(err.message, 'error') }
    finally { setSaving(false) }
  }

  const removeTx = async tx => {
    if (!confirm(`Delete “${tx.description}”? This affects everyone sharing the wallet.`)) return
    try { await api(`/api/shared/transactions/${tx.id}`, { method: 'DELETE' }); refresh(); notify('Shared transaction deleted') }
    catch (err) { notify(err.message, 'error') }
  }

  return <div className="stack gap-18">
    <section className="shared-intro glass">
      <div><p className="eyebrow">Collaborative ledger</p><h2>Shared Transactions</h2><p className="muted">Share selected wallets by email. View-only members can follow activity; editors can add, change, and remove transactions.</p></div>
      <span className="shared-intro-icon"><Share2/></span>
    </section>

    <section className="shared-grid">
      <div className="panel glass">
        <div className="panel-head"><div><p className="eyebrow">Share a wallet</p><h3>Invite by email</h3></div><MailPlus className="muted-icon"/></div>
        <form className="stack gap-12" onSubmit={submitShare}>
          <label className="field"><span>Wallet</span><select required value={share.wallet_id} onChange={e => setShare({ ...share, wallet_id: e.target.value })}><option value="">Choose a wallet</option>{personalWallets.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
          <label className="field"><span>User email</span><input required type="email" value={share.email} onChange={e => setShare({ ...share, email: e.target.value })} placeholder="person@example.com"/></label>
          <label className="field"><span>Permission</span><select value={share.permission} onChange={e => setShare({ ...share, permission: e.target.value })}><option value="view">Can view</option><option value="edit">Can edit</option></select></label>
          <button className="button primary self-start" disabled={sharing || !share.wallet_id || !share.email}>{sharing ? 'Sharing…' : 'Share wallet'}</button>
        </form>
      </div>

      <div className="panel glass">
        <div className="panel-head"><div><p className="eyebrow">Access</p><h3>Shared wallets</h3></div><Users className="muted-icon"/></div>
        {!sharedWallets.length ? <EmptyState title="Nothing shared yet" text="Invite someone above, or ask another FlowBudget user to share a wallet with your email."/> : <div className="shared-wallet-list">
          {sharedWallets.map(wallet => <div className="shared-wallet-card" key={wallet.wallet_id}>
            <div className="shared-wallet-title"><i style={{ background: wallet.color }}/><div><strong>{wallet.name}</strong><small>{wallet.is_owner ? 'You own this wallet' : `Owned by ${wallet.owner_name || wallet.owner_email}`}</small></div><span className={`permission-pill ${wallet.can_edit ? 'edit' : 'view'}`}>{wallet.can_edit ? 'Can edit' : 'View only'}</span></div>
            {wallet.is_owner && wallet.shares?.length > 0 && <div className="share-members">{wallet.shares.map(member => <div key={member.id}><span><strong>{member.email}</strong><small>{member.permission === 'edit' ? 'Can edit' : 'Can view'} · {member.registered ? 'Active user' : 'Pending signup'}</small></span><button className="row-icon danger" onClick={() => revoke(member)} aria-label={`Remove ${member.email}`}><Trash2/></button></div>)}</div>}
          </div>)}
        </div>}
      </div>
    </section>

    <section className="toolbar glass shared-toolbar">
      <div className="search-box"><Search size={18}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search shared transactions" /></div>
      <select className="toolbar-select" value={walletFilter} onChange={e => setWalletFilter(e.target.value)}><option value="">All shared wallets</option>{sharedWallets.map(w => <option key={w.wallet_id} value={w.wallet_id}>{w.name}</option>)}</select>
      <div className="segment-control compact-control"><button className={type==='all'?'active':''} onClick={() => setType('all')}>All</button><button className={type==='expense'?'active':''} onClick={() => setType('expense')}>Expenses</button><button className={type==='income'?'active':''} onClick={() => setType('income')}>Income</button><button className={type==='transfer'?'active':''} onClick={() => setType('transfer')}>Transfers</button></div>
      <button className="button primary" onClick={openNew} disabled={!editableWallets.length}><Plus size={18}/>New shared</button>
    </section>

    <section className="panel glass">
      <div className="panel-head"><div><p className="eyebrow">Shared ledger</p><h3>{rows.length} transaction{rows.length === 1 ? '' : 's'}</h3></div><Share2 size={18} className="muted-icon"/></div>
      {loading ? <div className="list-skeleton"><i/><i/><i/></div> : !rows.length ? <EmptyState title="No shared transactions" text="Shared-wallet activity will appear here."/> : <div className="date-groups">
        {Object.entries(grouped).map(([day, txs]) => <div className="date-group" key={day}>
          <div className="date-label"><strong>{format(new Date(day+'T12:00:00'), 'EEEE')}</strong><span>{format(new Date(day+'T12:00:00'), 'dd MMM yyyy')}</span></div>
          <AnimatePresence>{txs.map(tx => <motion.div className="transaction-row roomy shared-transaction-row" key={tx.id} layout initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} exit={{opacity:0,x:20}}>
            <span className={`tx-symbol ${tx.type}`}>{tx.type === 'income' ? <ArrowDownLeft size={18}/> : tx.type === 'transfer' ? <ArrowRightLeft size={18}/> : <ArrowUpRight size={18}/>}</span>
            <div className="tx-main"><strong>{tx.description}</strong><small>{tx.category_name || (tx.type === 'transfer' ? 'Transfer' : 'Uncategorized')} · {tx.owner_name || tx.owner_email}</small><div className="wallet-badges">{(tx.shared_wallet_names || []).map(name => <span key={name}>{name}</span>)}</div></div>
            <div className="tx-side"><strong className={`tx-amount ${tx.type}`}>{tx.type==='income'?'+':tx.type==='expense'?'−':''}{fmt(tx.amount)}</strong><small>{format(new Date(tx.date),'HH:mm')}</small></div>
            <div className="row-actions always">{tx.can_edit ? <><button onClick={() => openEdit(tx)} aria-label="Edit"><Pencil size={16}/></button><button className="danger" onClick={() => removeTx(tx)} aria-label="Delete"><Trash2 size={16}/></button></> : <span className="view-only-indicator"><Eye size={14}/></span>}</div>
          </motion.div>)}</AnimatePresence>
        </div>)}
      </div>}
    </section>

    <Modal open={modal} onClose={() => setModal(false)} title={editing ? 'Edit shared transaction' : 'New shared transaction'}>
      <form className="stack gap-16" onSubmit={saveTx}>
        <label className="field"><span>Shared wallet</span><select required value={draft.wallet_id} onChange={e => setDraft({ ...draft, wallet_id: e.target.value, transfer_wallet_id: '', category_id: '' })}>{editableWallets.map(w => <option key={w.wallet_id} value={w.wallet_id}>{w.name} · {w.owner_name || w.owner_email}</option>)}</select></label>
        <div className="segment-control"><button type="button" className={draft.type==='expense'?'active':''} onClick={() => setDraft({ ...draft, type:'expense', transfer_wallet_id:'', category_id:'' })}>Expense</button><button type="button" className={draft.type==='income'?'active':''} onClick={() => setDraft({ ...draft, type:'income', transfer_wallet_id:'', category_id:'' })}>Income</button><button type="button" className={draft.type==='transfer'?'active':''} onClick={() => setDraft({ ...draft, type:'transfer', category_id:'' })}>Transfer</button></div>
        <label className="field"><span>Amount</span><input required min="0.001" step="0.001" type="number" value={draft.amount} onChange={e => setDraft({ ...draft, amount: e.target.value })}/></label>
        <label className="field"><span>Description</span><input required maxLength="160" value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })}/></label>
        <div className="form-grid two">
          <label className="field"><span>Date & time</span><input required type="datetime-local" value={draft.date} onChange={e => setDraft({ ...draft, date: e.target.value })}/></label>
          {draft.type === 'transfer' ? <label className="field"><span>Destination shared wallet</span><select required value={draft.transfer_wallet_id} onChange={e => setDraft({ ...draft, transfer_wallet_id: e.target.value })}><option value="">Choose destination</option>{transferWallets.map(w => <option key={w.wallet_id} value={w.wallet_id}>{w.name}</option>)}</select></label> : <label className="field"><span>Category</span><select value={draft.category_id} onChange={e => setDraft({ ...draft, category_id: e.target.value })}><option value="">Uncategorized</option>{filteredCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
        </div>
        <label className="field"><span>Notes</span><textarea rows="3" value={draft.notes} onChange={e => setDraft({ ...draft, notes: e.target.value })}/></label>
        {draft.type === 'transfer' && !transferWallets.length && <div className="form-note">A shared transfer needs another editable wallet owned by the same person.</div>}
        <div className="modal-actions"><button type="button" className="button ghost" onClick={() => setModal(false)}>Cancel</button><button className="button primary" disabled={saving || !draft.wallet_id || !draft.amount || !draft.description || (draft.type === 'transfer' && !draft.transfer_wallet_id)}>{saving ? 'Saving…' : 'Save'}</button></div>
      </form>
    </Modal>
  </div>
}
