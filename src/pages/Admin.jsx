import { useEffect, useMemo, useState } from 'react'
import { Pencil, Plus, Search, ShieldCheck, Trash2, UserRoundCheck, UserRoundX } from 'lucide-react'
import { api, jsonBody } from '../lib/api'
import { useApp } from '../App'
import Modal from '../components/Modal'
import EmptyState from '../components/EmptyState'

const fresh = () => ({ username: '', email: '', password: '', role: 'user', active: true })

export default function Admin() {
  const { user, notify } = useApp()
  const [rows, setRows] = useState([])
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(fresh())
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => api('/api/admin/users').then(setRows)
  useEffect(() => { load() }, [])
  const visible = useMemo(() => rows.filter(row => `${row.username} ${row.email} ${row.role}`.toLowerCase().includes(search.toLowerCase())), [rows, search])

  const show = row => {
    setEditing(row || null)
    setForm(row ? { username: row.username, email: row.email, role: row.role, active: row.active, password: '' } : fresh())
    setError('')
    setOpen(true)
  }

  const submit = async e => {
    e.preventDefault(); setBusy(true); setError('')
    const payload = { ...form, email: form.email.trim(), username: form.username.trim() }
    if (editing && !payload.password) delete payload.password
    try {
      await api(editing ? `/api/admin/users/${editing.id}` : '/api/admin/users', { method: editing ? 'PUT' : 'POST', ...jsonBody(payload) })
      await load()
      setOpen(false)
      notify(editing ? 'User updated' : 'User created')
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  const remove = async row => {
    if (!confirm(`Delete ${row.username}? This removes their budget data too.`)) return
    try {
      await api(`/api/admin/users/${row.id}`, { method: 'DELETE' })
      await load()
      notify('User deleted')
    } catch (err) { notify(err.message, 'error') }
  }

  return <div className="stack gap-20">
    <section className="section-intro glass">
      <div>
        <p className="eyebrow"><ShieldCheck size={14}/> Admin workspace</p>
        <h2>Manage the people who use FlowBudget.</h2>
        <p className="muted">Create accounts, adjust roles, reset passwords, and retire users cleanly.</p>
      </div>
      <button className="button primary" onClick={() => show(null)}><Plus/>Add user</button>
    </section>

    <section className="toolbar glass">
      <div className="search-box"><Search size={18}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search users" /></div>
      <span className="admin-count">{visible.length} visible</span>
    </section>

    <section className="panel glass">
      <div className="panel-head"><div><p className="eyebrow">Accounts</p><h3>User directory</h3></div></div>
      {!visible.length ? <EmptyState title="No users found" text="Try a different search or create a teammate."/> : <div className="user-table">
        {visible.map(row => <article className="user-row" key={row.id}>
          <span className={`round-icon ${row.active ? '' : 'inactive'}`}>{row.active ? <UserRoundCheck/> : <UserRoundX/>}</span>
          <div className="tx-main"><strong>{row.username}</strong><small>{row.email}</small></div>
          <span className={`role-pill ${row.role}`}>{row.role}</span>
          <span className={`status-pill ${row.active ? 'active' : 'inactive'}`}>{row.active ? 'Active' : 'Inactive'}</span>
          <div className="row-actions always"><button onClick={() => show(row)} aria-label="Edit"><Pencil size={16}/></button><button className="danger" disabled={row.id === user.id} onClick={() => remove(row)} aria-label="Delete"><Trash2 size={16}/></button></div>
        </article>)}
      </div>}
    </section>

    <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Edit user' : 'Create user'} subtitle={editing ? 'Leave password empty to keep the current one.' : 'New users receive their own starter workspace.'}>
      <form onSubmit={submit} className="stack gap-16">
        <label className="field"><span>Name</span><input required value={form.username} onChange={e => setForm({...form, username: e.target.value})}/></label>
        <label className="field"><span>Email</span><input required type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})}/></label>
        <div className="form-grid two">
          <label className="field"><span>Role</span><select value={form.role} onChange={e => setForm({...form, role: e.target.value})}><option value="user">User</option><option value="admin">Admin</option></select></label>
          <label className="field"><span>Password</span><input required={!editing} type="password" minLength="8" value={form.password} onChange={e => setForm({...form, password: e.target.value})}/></label>
        </div>
        <label className="check-row"><input type="checkbox" checked={form.active} onChange={e => setForm({...form, active: e.target.checked})}/><span>Account is active</span></label>
        {error && <div className="form-error">{error}</div>}
        <div className="modal-actions"><button className="button ghost" type="button" onClick={() => setOpen(false)}>Cancel</button><button className="button primary" disabled={busy}>{busy ? 'Saving...' : 'Save user'}</button></div>
      </form>
    </Modal>
  </div>
}
