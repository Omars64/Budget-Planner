import { useEffect, useState } from 'react'
import { Check, ChevronDown, Plus, Users, UserRound, Settings2, Trash2 } from 'lucide-react'
import { useApp } from '../App'
import { api, jsonBody } from '../lib/api'
import { SPACE_COLORS } from '../lib/spaces'
import Modal from './Modal'
import CurrencyField from './CurrencyField'

const roleNames = { owner: 'Owner', edit: 'Manager', add: 'Contributor', view: 'Viewer' }
const fresh = currency => ({ name: '', color: 'green', currency })

export default function SpaceSwitcher() {
  const { activeSpace, spaces = [], switchSpace, reloadSpaces, settings, isGuest, requestSignIn, notify, confirm } = useApp()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [manage, setManage] = useState(false)
  const [form, setForm] = useState(() => fresh(settings.currency))
  const [member, setMember] = useState({ email: '', role: 'add' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { setOpen(false); setManage(false) }, [activeSpace?.id])
  const choose = async id => { if (await switchSpace(id)) setOpen(false) }
  const create = () => {
    if (isGuest) { requestSignIn('shared spaces'); return }
    setEditing(null); setForm(fresh(settings.currency)); setError(''); setOpen(false); setManage(true)
  }
  const show = () => {
    setEditing(activeSpace); setForm({ name: activeSpace.name, color: activeSpace.color, currency: activeSpace.currency }); setMember({email:'',role:'add'}); setError(''); setOpen(false); setManage(true)
  }
  const save = async event => {
    event.preventDefault()
    if (busy) return
    setBusy(true); setError('')
    try {
      const result = await api(editing ? `/api/spaces/${editing.id}` : '/api/spaces', {method:editing ? 'PUT' : 'POST', ...jsonBody(form)})
      await reloadSpaces(); setManage(false)
      await switchSpace(result.id)
      notify(editing ? 'Space updated' : 'Space created. Add a wallet to begin.')
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  const grant = async event => {
    event.preventDefault()
    if (busy) return
    if (!await confirm(`Give ${member.email} ${roleNames[member.role].toLowerCase()} access to all records in ${editing.name}?`)) return
    setBusy(true); setError('')
    try {
      const result = await api(`/api/spaces/${editing.id}/members`, {method:'PUT',...jsonBody(member)})
      setEditing(result); setMember({email:'',role:'add'}); await reloadSpaces(); notify('Membership saved')
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  const remove = async email => {
    if (!await confirm(`Remove ${email} from ${editing.name}? Their existing records will remain.`)) return
    setBusy(true); setError('')
    try {
      setEditing(await api(`/api/spaces/${editing.id}/members/${encodeURIComponent(email)}`, {method:'DELETE'}))
      await reloadSpaces(); notify('Member removed')
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  return <div className="space-switcher">
    <button className="space-selector" onClick={() => setOpen(true)} aria-label={`Switch space. Current: ${activeSpace?.name || 'Personal'}`} aria-haspopup="dialog"><span className="space-symbol">{activeSpace ? <Users size={18}/> : <UserRound size={18}/>}</span><span className="space-selector-label">{activeSpace?.name || 'Personal'}<small>{activeSpace ? roleNames[activeSpace.role] : 'Only you'}</small></span><ChevronDown size={16}/></button>
    <Modal open={open} onClose={() => setOpen(false)} title="Your spaces">
      <div className="space-options">
        <button className={!activeSpace ? 'selected' : ''} onClick={() => choose(null)}><UserRound/><span>Personal<small>Private records</small></span>{!activeSpace && <Check size={18}/>}</button>
        {spaces.map(space => <button key={space.id} className={space.id === activeSpace?.id ? 'selected' : ''} onClick={() => choose(space.id)}><Users style={{color:space.accent}}/><span>{space.name}<small>{space.owner_name} · {space.members.length} members · {roleNames[space.role]}</small></span>{space.id === activeSpace?.id && <Check size={18}/>}</button>)}
        <button onClick={create}><Plus/><span>Create space</span></button>
        {activeSpace && <button onClick={show}><Settings2/><span>Space settings & members</span></button>}
      </div>
    </Modal>
    <Modal protectChanges open={manage} onClose={() => !busy && setManage(false)} title={editing ? editing.name : 'Create space'}>
      <div className="stack gap-22">
        {error && <p className="form-error" role="alert">{error}</p>}
        {(!editing || editing.role === 'owner') ? <form onSubmit={save} className="stack gap-16">
          <label className="field"><span>Space name</span><input required maxLength={80} value={form.name} onChange={e => setForm({...form,name:e.target.value})} placeholder="Home, trip or project"/></label>
          <fieldset className="space-palette"><legend>Space color</legend><div>{SPACE_COLORS.map(color => <button type="button" key={color.key} title={color.label} aria-label={color.label} aria-pressed={form.color === color.key} style={{'--swatch':color.accent}} onClick={() => setForm({...form,color:color.key})}>{form.color === color.key && <Check size={17}/>}</button>)}</div></fieldset>
          {!editing && <CurrencyField scope="space" value={form.currency} onChange={currency => setForm({...form,currency})}/>}
          <div className="modal-actions"><button type="button" className="button ghost" onClick={() => setManage(false)}>Cancel</button><button className="button primary" disabled={busy}>{busy ? 'Saving...' : editing ? 'Save changes' : 'Create space'}</button></div>
        </form> : <p className="muted">{editing.owner_name} manages this space. Your role: {roleNames[editing.role]}.</p>}
        {editing && <section className="space-members"><h3>Members</h3>{editing.members.map(person => <div className="space-member" key={person.email}><span>{person.name || person.email}<small>{person.name && person.email} {roleNames[person.role]}</small></span>{editing.role === 'owner' && person.role !== 'owner' && <div className="button-row"><button className="icon-button" title="Change role" aria-label={`Change role for ${person.email}`} disabled={busy} onClick={() => setMember({email:person.email,role:person.role})}><Settings2 size={17}/></button><button className="icon-button danger" title="Remove member" aria-label={`Remove ${person.email}`} disabled={busy} onClick={() => remove(person.email)}><Trash2 size={17}/></button></div>}</div>)}</section>}
        {editing?.role === 'owner' && <form onSubmit={grant} className="stack gap-16"><h3>Add or update member</h3><label className="field"><span>Email</span><input type="email" required value={member.email} onChange={e => setMember({...member,email:e.target.value})}/></label><label className="field"><span>Role</span><select value={member.role} onChange={e => setMember({...member,role:e.target.value})}><option value="view">Viewer · read only</option><option value="add">Contributor · add transactions</option><option value="edit">Manager · manage records</option></select></label><button className="button primary" disabled={busy}>Save membership</button></form>}
      </div>
    </Modal>
  </div>
}
