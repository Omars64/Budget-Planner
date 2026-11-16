import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, Eye, UserRound, UserRoundPlus } from 'lucide-react'
import { useApp } from '../App'
import AppSelect from '../components/AppSelect'
import Modal from '../components/Modal'
import { api, jsonBody } from '../lib/api'
import { currencyLabel } from '../lib/currency'
import { debtApi, debtPath, debtRoles, debtUrl } from '../lib/debtWorkspace'

function MemberLabel({ person }) {
  return <><span className="debt-row-icon"><UserRound size={18} aria-hidden="true"/></span>
    <span className="debt-row-label"><strong>{person.name || person.email}</strong><small>{debtRoles[person.role]}</small></span></>
}

export default function DebtSpaceManagement({ space, currency, readOnly, onClose, onDeleted }) {
  const { notify, confirm, rememberDebtSpace, forgetDeletedDebtSpace, reloadDebtSpaces, refreshDebtSpaces } = useApp()
  const navigate = useNavigate()
  const id = space?.id
  const path = debtApi(id)
  const [details, setDetails] = useState(null)
  const [name, setName] = useState('')
  const [loadError, setLoadError] = useState('')
  const [retry, setRetry] = useState(0)
  const [view, setView] = useState('details')
  const [member, setMember] = useState(null)
  const [deleteName, setDeleteName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(false)
  const cancelDelete = useRef(null)
  const owner = !readOnly && space?.role === 'owner' && details?.role === 'owner'
  const members = details?.members || []
  const guests = members.filter(person => person.role !== 'owner')

  useEffect(() => {
    if (!id) return
    const controller = new AbortController()
    api(`${path}/access`, { signal: controller.signal }).then(data => {
      if (controller.signal.aborted) return
      setDetails(data)
      setName(data.name)
      setLoadError('')
    }).catch(failure => {
      if (!controller.signal.aborted) setLoadError(failure.message)
    })
    return () => controller.abort()
  }, [id, path, retry])
  useEffect(() => {
    if (view === 'confirm-delete') cancelDelete.current?.focus()
  }, [view])

  const close = () => { if (!pending.current) onClose() }
  const show = next => { setView(next); setError('') }
  async function run(action) {
    if (pending.current || readOnly) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (failure) {
      setError(failure.network && view === 'confirm-delete'
        ? 'Deletion could not be confirmed. Check the debt spaces list before trying again.'
        : failure.message)
      if (view === 'confirm-delete' || [403,404].includes(failure.status)) {
        void reloadDebtSpaces().catch(() => {})
      }
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  const saveDetails = event => {
    event.preventDefault()
    if (id && !owner) return
    void run(async () => {
      if (!name.trim()) throw new Error('Enter a space name.')
      const data = id ? { name: name.trim() } : { name: name.trim(), currency }
      const result = await api(id ? path : `${debtPath}/spaces`, { method: id ? 'PATCH' : 'POST', ...jsonBody(data) })
      rememberDebtSpace(result)
      onClose()
      notify(id ? 'Space details saved' : 'Shared debt space created')
      void reloadDebtSpaces().catch(() => {})
    })
  }
  const editMember = person => {
    setMember(person ? { email: person.email, role: person.role, editing: true } : { email: '', role: 'view', editing: false })
    show('edit-member')
  }
  const updateMembership = async remove => {
    if (!owner) return
    await run(async () => {
      const email = member.email.trim().toLowerCase()
      if (remove && !await confirm(`Remove access for ${email} from ${details.name}?`)) return
      const result = remove
        ? await api(`${path}/members/${encodeURIComponent(email)}`, { method: 'DELETE' })
        : await api(`${path}/members`, { method: 'PUT', ...jsonBody({ email, role: member.role }) })
      setDetails(result)
      rememberDebtSpace(result)
      show('members')
      notify(remove ? 'Access removed' : member.editing ? 'Role saved' : 'Person added')
      void refreshDebtSpaces().catch(() => {})
    })
  }
  const matchesName = owner && deleteName === details.name
  const deleteSpace = event => {
    event.preventDefault()
    if (!matchesName || view !== 'confirm-delete') return
    void run(async () => {
      await api(path, { method: 'DELETE', ...jsonBody({ confirmation_name: deleteName }) })
      forgetDeletedDebtSpace(id)
      onDeleted(id)
      notify(`“${details.name}” deleted`)
      void reloadDebtSpaces().catch(() => {})
    })
  }

  const showTabs = details && ['details','members','delete'].includes(view)
  const title = !id ? 'Create debt space' : view === 'confirm-delete' ? `Delete “${details.name}”?`
    : view === 'edit-member' ? member.editing ? 'Change access' : 'Add a person'
    : view === 'preview' ? 'Preview member view' : details?.name || space.name
  const shownCurrency = id ? details?.currency : currency
  const actionError = error && <p className="form-error" role="alert">{error}</p>

  return <Modal open onClose={close} title={title} layerClass="space-switcher-dialog debt-space-management">
    <div className="space-management stack gap-16" aria-busy={busy}>
      {showTabs && <div className="space-management-views" role="group" aria-label="Workspace settings">
        <button type="button" aria-pressed={view === 'details'} disabled={busy} onClick={() => show('details')}>Space details</button>
        <button type="button" aria-pressed={view === 'members'} disabled={busy} onClick={() => show('members')}>Members</button>
        {owner && <button type="button" className="space-delete-tab" aria-pressed={view === 'delete'} disabled={busy} onClick={() => show('delete')}>Delete space</button>}
      </div>}
      {id && !details && (loadError
        ? <p className="form-error" role="alert">{loadError} <button type="button" className="button ghost" onClick={() => {setLoadError('');setRetry(value => value+1)}}>Retry</button></p>
        : <p role="status">Loading space details…</p>)}
      {view === 'details' && (details || !id) && <form className="stack gap-16" onSubmit={saveDetails}>
        <label className="field"><span>Space name</span><input maxLength={40} value={name} onChange={event => {setName(event.target.value);setError('')}}
          placeholder="e.g. Household debts" disabled={busy} readOnly={Boolean(id && !owner)} required/></label>
        {shownCurrency && <div><strong>Currency</strong><div className="muted">{currencyLabel(shownCurrency)}</div></div>}
        {actionError}
        <div className="modal-actions">
          <button type="button" className="button ghost" disabled={busy} onClick={close}>{id && !owner ? 'Close' : 'Cancel'}</button>
          {(!id || owner) && <button type="submit" className="button primary" disabled={busy}>{busy ? 'Saving…' : id ? 'Save details' : 'Create space'}</button>}
        </div>
      </form>}
      {view === 'members' && details && <>
        <ul className="debt-list">{members.map(person => <li key={person.email}>
          {owner && person.role !== 'owner'
            ? <button type="button" className="debt-row" onClick={() => editMember(person)}><MemberLabel person={person}/><ChevronRight size={16} aria-hidden="true"/></button>
            : <div className="debt-row"><MemberLabel person={person}/></div>}
        </li>)}</ul>
        {owner && <div className="button-row">
          <button type="button" className="button primary" onClick={() => editMember()}><UserRoundPlus size={18}/>Add a person</button>
          {guests.length > 0 && <button type="button" className="button ghost" onClick={() => show('preview')}><Eye size={18}/>Preview member view</button>}
        </div>}
      </>}
      {view === 'edit-member' && owner && <form className="stack gap-16" onSubmit={event => {event.preventDefault();void updateMembership(false)}}>
        {member.editing ? <strong>{member.email}</strong> : <label className="field"><span>Budgetly account email</span>
          <input type="email" maxLength={160} value={member.email} disabled={busy} onChange={event => setMember({...member, email:event.target.value})} required/></label>}
        <label className="field"><span>Role</span><AppSelect value={member.role} disabled={busy} onChange={event => setMember({...member, role:event.target.value})}>
          <option value="view">Viewer · read only</option><option value="edit">Manager · manage records</option>
        </AppSelect></label>
        <small className="muted">This gives access to every debt record in {details.name}.</small>
        {member.editing && <div><button type="button" className="button ghost" disabled={busy} onClick={() => void updateMembership(true)}>Remove access</button></div>}
        {actionError}
        <div className="modal-actions"><button type="button" className="button ghost" disabled={busy} onClick={() => show('members')}>Cancel</button>
          <button type="submit" className="button primary" disabled={busy}>{busy ? 'Saving…' : member.editing ? 'Save role' : 'Add to space'}</button></div>
      </form>}
      {view === 'preview' && owner && <>
        <ul className="debt-list">{guests.map(person => <li key={person.email}>
          <button type="button" className="debt-row" onClick={() => navigate(`${debtUrl(id)}?preview=${person.role}`)}><MemberLabel person={person}/><Eye size={16} aria-hidden="true"/></button>
        </li>)}</ul><div><button type="button" className="button ghost" onClick={() => show('members')}>Back</button></div>
      </>}
      {view === 'delete' && owner && <form className="stack gap-16" onSubmit={event => {event.preventDefault();if (matchesName) show('confirm-delete')}}>
        <div className="space-delete-panel"><h3>Delete this shared debt space?</h3>
          <p>This removes the debts, repayment schedule, payment history and reminders for everyone in this space.</p></div>
        <label className="field"><span>Type “{details.name}” to continue</span><input value={deleteName} maxLength={40} autoComplete="off" spellCheck={false}
          onChange={event => setDeleteName(event.target.value)} required/></label>
        <div className="modal-actions"><button type="button" className="button ghost" onClick={close}>Cancel</button>
          <button type="submit" className="button danger" disabled={!matchesName}>Continue to delete</button></div>
      </form>}
      {view === 'confirm-delete' && owner && <form className="stack gap-16" onSubmit={deleteSpace}>
        <p>Everyone will lose access to this space and its records. This cannot be undone from Debt spaces.</p>
        {actionError}
        <div className="modal-actions"><button type="button" className="button ghost" disabled={busy} ref={cancelDelete} onClick={() => {setDeleteName('');show('delete')}}>Cancel</button>
          <button type="submit" className="button danger" disabled={busy || !matchesName}>{busy ? 'Deleting…' : 'Delete space permanently'}</button></div>
      </form>}
    </div>
  </Modal>
}
