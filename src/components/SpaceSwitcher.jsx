import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Plus, Users, UserRound, Settings2, Trash2 } from 'lucide-react'
import { useApp } from '../App'
import { api, jsonBody } from '../lib/api'
import { SPACE_COLORS } from '../lib/spaces'
import Modal from './Modal'
import CurrencyField from './CurrencyField'
import './SpaceSwitcher.css'

const roleNames = { owner: 'Owner', edit: 'Manager', add: 'Manager', view: 'Viewer' }
const fresh = currency => ({ name: '', color: 'green', currency })
const emptyMember = () => ({ email: '', role: 'view' })
const details = space => ({ name: space.name, color: space.color, currency: space.currency })

export default function SpaceSwitcher() {
  const { activeSpace, spaces = [], switchSpace, reloadSpaces, settings, isGuest, requestSignIn, notify, confirm } = useApp()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [manage, setManage] = useState(false)
  const [view, setView] = useState('details')
  const [form, setForm] = useState(() => fresh(settings.currency))
  const [member, setMember] = useState(emptyMember)
  const [busy, setBusy] = useState('')
  const pending = useRef(false)
  const [error, setError] = useState('')
  const [detailStatus, setDetailStatus] = useState('')
  const [memberStatus, setMemberStatus] = useState('')
  const [memberError, setMemberError] = useState('')
  const owner = editing?.role === 'owner'
  const dirty = (owner || !editing) && (
    JSON.stringify(form) !== JSON.stringify(editing ? details(editing) : fresh(settings.currency)) ||
    Boolean(member.email || member.role !== 'view')
  )
  useEffect(() => { setOpen(false) }, [activeSpace?.id])
  const choose = async id => { if (await switchSpace(id)) setOpen(false) }
  const show = (space = null) => {
    if (!space && isGuest) { requestSignIn('shared spaces'); return }
    setEditing(space); setForm(space ? details(space) : fresh(settings.currency))
    setMember(emptyMember()); setError(''); setMemberError(''); setMemberStatus(''); setDetailStatus('')
    setView('details'); setOpen(false); setManage(true)
  }
  const refresh = async () => {
    try { await reloadSpaces() } catch { notify('Saved, but the spaces list could not refresh. Reopen it to try again.') }
  }
  const save = async event => {
    event.preventDefault()
    if (pending.current || (editing && !owner)) return
    if (!form.name.trim()) { setError('Enter a Space name.'); return }
    pending.current = true; setBusy('details'); setError(''); setDetailStatus('')
    try {
      const result = await api(editing ? `/api/spaces/${editing.id}` : '/api/spaces', { method: editing ? 'PUT' : 'POST', ...jsonBody({ ...form, name: form.name.trim() }) })
      setEditing(result); setForm(details(result)); setDetailStatus('Space details saved.')
      await refresh()
      if (!editing) { setManage(false); await switchSpace(result.id); notify('Space created. Add a wallet to begin.') }
    } catch (err) { setError(err.message) } finally { pending.current = false; setBusy('') }
  }
  // Lock before confirmation as well as the request, so repeated clicks cannot queue writes.
  const saveMember = async (event, emailToRemove) => {
    event?.preventDefault()
    if (pending.current || !owner) return
    const payload = { email: member.email.trim().toLowerCase(), role: member.role }
    setMemberError(''); setMemberStatus('')
    if (!emailToRemove && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email) || !['view', 'edit'].includes(payload.role))) {
      setMemberError('Enter a valid email and choose Viewer or Manager.'); return
    }
    if (!emailToRemove && editing.members.some(person => person.role === 'owner' && person.email.toLowerCase() === payload.email)) {
      setMemberError('The owner already has full access.'); return
    }
    pending.current = true; setBusy('confirm')
    try {
      const message = emailToRemove
        ? `Remove ${emailToRemove} from ${editing.name}? Their existing records will remain.`
        : `Give ${payload.email} ${roleNames[payload.role].toLowerCase()} access to all records in ${editing.name}?`
      if (!await confirm(message)) return
      setBusy('members')
      const result = await api(emailToRemove
        ? `/api/spaces/${editing.id}/members/${encodeURIComponent(emailToRemove)}`
        : `/api/spaces/${editing.id}/members`, emailToRemove ? { method: 'DELETE' } : { method: 'PUT', ...jsonBody(payload) })
      // Membership responses include details; preserve the independent details draft.
      setEditing(result)
      if (!emailToRemove || member.email.trim().toLowerCase() === emailToRemove.toLowerCase()) setMember(emptyMember())
      setMemberStatus(emailToRemove ? 'Member removed.' : 'Membership saved.')
      await refresh()
    } catch (err) { setMemberError(err.message || 'Membership could not be saved. Try again.') }
    finally { pending.current = false; setBusy('') }
  }
  const changeMember = next => { setMember(next); setMemberError(''); setMemberStatus('') }
  const changeDetails = next => { setForm(next); setError(''); setDetailStatus('') }

  return <div className="space-switcher">
    <button className="space-selector" onClick={() => setOpen(true)} aria-label={`Switch space. Current: ${activeSpace?.name || 'Personal'}`} aria-haspopup="dialog"><span className="space-symbol">{activeSpace ? <Users size={18}/> : <UserRound size={18}/>}</span><span className="space-selector-label">{activeSpace?.name || 'Personal'}<small>{activeSpace ? roleNames[activeSpace.role] : 'Only you'}</small></span><ChevronDown size={16}/></button>
    <Modal open={open} onClose={() => setOpen(false)} title="Your spaces" layerClass="space-switcher-dialog">
      <div className="space-options">
        <button className={!activeSpace ? 'selected' : ''} onClick={() => choose(null)}><UserRound/><span>Personal<small>Private records</small></span>{!activeSpace && <Check size={18}/>}</button>
        {spaces.map(space => <div className={`space-option-row${space.id === activeSpace?.id ? ' selected' : ''}`} key={space.id}>
          <button className="space-option-choose" onClick={() => choose(space.id)} aria-label={`Switch to ${space.name}`} aria-current={space.id === activeSpace?.id ? 'true' : undefined}><Users style={{ color: space.accent }}/><span>{space.name}<small>{space.owner_name} · {space.members.length} members · {roleNames[space.role]}</small></span>{space.id === activeSpace?.id && <Check size={18}/>}</button>
          <button className="space-option-manage" onClick={() => show(space)}><Settings2 size={16}/><span>{space.role === 'owner' ? 'Manage workspace' : 'View settings & members'} {space.name}</span></button>
        </div>)}
        <button onClick={() => show()}><Plus/><span>Create space</span></button>
      </div>
    </Modal>
    <Modal protectChanges isDirty={Boolean(dirty)} open={manage} onClose={() => !pending.current && setManage(false)} title={editing ? editing.name : 'Create space'} layerClass="space-switcher-dialog">
      <div className="space-management stack gap-22">
        {editing && <nav className="space-management-views" aria-label="Workspace settings views">
          <button type="button" aria-pressed={view === 'details'} onClick={() => setView('details')}>Space details</button>
          <button type="button" aria-pressed={view === 'members'} onClick={() => setView('members')}>Members</button>
        </nav>}
        {editing && !owner && <p className="muted">{editing.owner_name} manages this space. Your role: {roleNames[editing.role]}. Only the owner can change Space details and membership.</p>}
        {view === 'details' && ((!editing || owner) ? <form onSubmit={save} className="stack gap-16" aria-label="Space details" aria-busy={busy === 'details'}>
          <fieldset disabled={Boolean(busy)} className="space-form-fields stack gap-16">
            <label className="field"><span>Space name</span><input required maxLength={80} value={form.name} onChange={e => changeDetails({ ...form, name: e.target.value })} placeholder="Home, trip or project" aria-invalid={Boolean(error)} aria-describedby={error ? 'space-details-error' : undefined}/></label>
            <fieldset className="space-palette"><legend>Space color</legend><div>{SPACE_COLORS.map(color => <button type="button" key={color.key} title={color.label} aria-label={color.label} aria-pressed={form.color === color.key} style={{ '--swatch': color.accent }} onClick={() => changeDetails({ ...form, color: color.key })}>{form.color === color.key && <Check size={17}/>}</button>)}</div></fieldset>
            {!editing && <CurrencyField scope="space" value={form.currency} onChange={currency => changeDetails({ ...form, currency })}/>}
            {editing && <p className="muted">Currency: {editing.currency}</p>}
            <div className="space-save-row"><button className="button primary" disabled={Boolean(busy)}>{busy === 'details' ? 'Saving...' : editing ? 'Save Space details' : 'Create space'}</button><span role="status">{detailStatus}</span></div>
          </fieldset>
          {error && <p id="space-details-error" className="form-error" role="alert">{error}</p>}
        </form> : <dl className="space-readonly-details"><dt>Space name</dt><dd>{editing.name}</dd><dt>Space color</dt><dd>{SPACE_COLORS.find(color => color.key === editing.color)?.label || editing.color}</dd><dt>Currency</dt><dd>{editing.currency}</dd></dl>)}
        {editing && view === 'members' && <section className="space-members" aria-label="Workspace members">
          <h3>Members</h3>
          {editing.members.map(person => <div className="space-member" key={person.email}><span>{person.name || person.email}<small>{person.name && person.email} {roleNames[person.role]}</small></span>{owner && person.role !== 'owner' && <div className="button-row"><button className="icon-button" title="Change role" aria-label={`Change role for ${person.email}`} disabled={Boolean(busy)} onClick={() => changeMember({ email: person.email, role: person.role === 'add' ? 'edit' : person.role })}><Settings2 size={17}/></button><button className="icon-button danger" title="Remove member" aria-label={`Remove ${person.email}`} disabled={Boolean(busy)} onClick={() => saveMember(null, person.email)}><Trash2 size={17}/></button></div>}</div>)}
          {owner && <form onSubmit={event => saveMember(event)} className="space-member-form stack gap-16" aria-label="Add or update member" aria-busy={busy === 'members'}>
            <h3>Add or update member</h3>
            <fieldset disabled={Boolean(busy)} className="space-form-fields stack gap-16">
              <label className="field"><span>Email</span><input type="email" required value={member.email} onChange={e => changeMember({ ...member, email: e.target.value })} aria-invalid={Boolean(memberError)} aria-describedby={memberError ? 'space-member-error' : undefined}/></label>
              <label className="field"><span>Role</span><select value={member.role} onChange={e => changeMember({ ...member, role: e.target.value })}><option value="view">Viewer · read only</option><option value="edit">Manager · manage records</option></select></label>
              <div className="space-save-row"><button className="button primary" disabled={Boolean(busy)}>{busy === 'members' ? 'Saving membership...' : busy === 'confirm' ? 'Awaiting confirmation...' : 'Save membership'}</button><span role="status" aria-live="polite">{busy === 'members' ? 'Saving membership...' : memberStatus}</span>{memberError && <p id="space-member-error" className="form-error" role="alert">{memberError}</p>}</div>
            </fieldset>
          </form>}
        </section>}
      </div>
    </Modal>
  </div>
}
