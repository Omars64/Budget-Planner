import { showTime } from '../lib/time'
import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Download, Folder, FolderPlus, FileText, History, Pin, Plus, Save, Search, Share2, Trash2, Pencil, RefreshCw } from 'lucide-react'
import { api, jsonBody } from '../lib/api'
import { useApp } from '../App'
import Modal from '../components/Modal'

export default function Notes() {
  const { user, notify, confirm } = useApp()
  const draftKey = `flowbudget_note_draft_${user.id}`
  const [restored] = useState(() => {
    try { const value = JSON.parse(sessionStorage.getItem(draftKey)); return value && typeof value.title === 'string' && typeof value.content === 'string' ? value : null }
    catch { return null }
  })
  const [notes, setNotes] = useState([])
  const [folders, setFolders] = useState([])
  const [folder, setFolder] = useState('all')
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState(restored)
  const [dirty, setDirty] = useState(Boolean(restored))
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [folderEdit, setFolderEdit] = useState(null)
  const [sharing, setSharing] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory] = useState([])
  const [invite, setInvite] = useState({ email: '', permission: 'view' })

  useEffect(() => {
    try {
      if (dirty && draft) sessionStorage.setItem(draftKey, JSON.stringify(draft))
      else sessionStorage.removeItem(draftKey)
    } catch { /* Saving to the server remains available when browser storage is full. */ }
  }, [draftKey, dirty, draft])

  const load = async () => {
    const [n, f] = await Promise.all([api('/api/notes'), api('/api/note-folders')])
    setNotes(n); setFolders(f); setLoading(false)
    return n
  }
  useEffect(() => {
    let cancelled = false
    const sync = async () => {
      if (document.visibilityState === 'hidden') return
      try {
        const [n, f] = await Promise.all([api('/api/notes'), api('/api/note-folders')])
        if (cancelled) return
        setNotes(n); setFolders(f); setLoading(false)
        if (!dirty) setDraft(current => current?.id ? n.find(x => x.id === current.id) || null : current)
      } catch (err) { if (!cancelled) { setError(err.message); setLoading(false) } }
    }
    sync()
    const timer = setInterval(sync, 10000)
    window.addEventListener('focus', sync)
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener('focus', sync) }
  }, [dirty])
  const visible = useMemo(() => notes.filter(n =>
    (folder === 'shared' ? !n.is_owner : n.is_owner && (folder === 'all' || (folder === 'pinned' ? n.pinned : String(n.folder_id) === folder))) &&
    `${n.title} ${n.content}`.toLowerCase().includes(search.toLowerCase())), [notes, folder, search])
  const leave = async () => !dirty || await confirm('Discard unsaved changes to this note?')
  const select = async note => { if (await leave()) { setDraft(note); setDirty(false); setError('') } }
  const changeFolder = async value => { if (await leave()) { setFolder(value); setDraft(null); setDirty(false); setError('') } }
  const change = patch => { setDraft(d => ({ ...d, ...patch })); setDirty(true) }
  const save = async () => {
    setBusy(true); setError('')
    try {
      const result = await api(draft.id ? `/api/notes/${draft.id}` : '/api/notes', { method: draft.id ? 'PUT' : 'POST', ...jsonBody(draft) })
      setDraft(result); setDirty(false); await load(); notify('Note saved')
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  const remove = async () => {
    if (!await confirm('Delete this note? Everyone sharing it will lose access.')) return
    setBusy(true)
    try { await api(`/api/notes/${draft.id}`, { method: 'DELETE' }); setDraft(null); setDirty(false); await load(); notify('Note deleted') }
    catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  const saveFolder = async e => {
    e.preventDefault(); setBusy(true)
    try { await api(folderEdit.id ? `/api/note-folders/${folderEdit.id}` : '/api/note-folders', { method: folderEdit.id ? 'PUT' : 'POST', ...jsonBody({ name: folderEdit.name }) }); setFolderEdit(null); await load() }
    catch (err) { notify(err.message, 'error') } finally { setBusy(false) }
  }
  const removeFolder = async item => {
    if (!await leave() || !await confirm(`Delete folder "${item.name}"? Its notes will remain in All notes.`)) return
    try { await api(`/api/note-folders/${item.id}`, { method: 'DELETE' }); setFolder('all'); setDraft(null); setDirty(false); await load() }
    catch (err) { notify(err.message, 'error') }
  }
  const share = async e => {
    e.preventDefault(); setBusy(true)
    try { await api(`/api/notes/${draft.id}/shares`, { method: 'POST', ...jsonBody(invite) }); setDraft((await load()).find(n => n.id === draft.id)); setInvite({ email: '', permission: 'view' }); notify('Note access updated') }
    catch (err) { notify(err.message, 'error') } finally { setBusy(false) }
  }
  const unshare = async item => {
    if (!await confirm(`Remove access for ${item.email}?`)) return
    try { await api(`/api/notes/${draft.id}/shares/${item.id}`, { method: 'DELETE' }); setDraft((await load()).find(n => n.id === draft.id)) }
    catch (err) { notify(err.message, 'error') }
  }
  const showHistory = async () => {
    try { setHistory(await api(`/api/notes/${draft.id}/history`)); setHistoryOpen(true) }
    catch (err) { notify(err.message, 'error') }
  }
  const download = () => {
    const url = URL.createObjectURL(new Blob([`${draft.title}\n\n${draft.content}`], { type: 'text/plain' }))
    const link = document.createElement('a'); link.href = url; link.download = 'Budgetly-note.txt'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <div className={`workspace notes-workspace ${draft ? 'has-selection' : ''}`}>
    <aside className="workspace-folders">
      <div className="workspace-heading"><h3>Folders</h3><button title="New folder" aria-label="New folder" className="icon-button" onClick={() => setFolderEdit({ name: '' })}><FolderPlus size={18}/></button></div>
      {[['all', 'All notes', FileText], ['pinned', 'Pinned', Pin], ['shared', 'Shared notes', Share2]].map(([key, label, Icon]) => <button key={key} className={`folder-link ${folder === key ? 'selected' : ''}`} onClick={() => changeFolder(key)}><Icon size={17}/>{label}</button>)}
      <div className="folder-divider"/>
      {folders.map(f => <div className="folder-row" key={f.id}><button className={`folder-link ${folder === String(f.id) ? 'selected' : ''}`} onClick={() => changeFolder(String(f.id))}><Folder size={16}/><span>{f.name}</span></button><button className="icon-button" title="Rename folder" aria-label={`Rename ${f.name}`} onClick={() => setFolderEdit(f)}><Pencil size={13}/></button><button className="icon-button" title="Delete folder" aria-label={`Delete ${f.name}`} onClick={() => removeFolder(f)}><Trash2 size={13}/></button></div>)}
    </aside>
    <section className="workspace-list">
      <div className="workspace-heading"><h3>{folder === 'shared' ? 'Shared notes' : 'Notes'} <small>{visible.length}</small></h3><button className="icon-button" title="New note" aria-label="New note" onClick={() => select({ title: '', content: '', folder_id: /^\d+$/.test(folder) ? Number(folder) : null, pinned: false, version: 1, is_owner: true, can_edit: true })}><Plus size={20}/></button></div>
      <div className="workspace-search"><Search size={16}/><input aria-label="Search notes" placeholder="Search notes" value={search} onChange={e => setSearch(e.target.value)}/></div>
      {loading ? <p className="workspace-empty">Loading notes...</p> : !visible.length ? <p className="workspace-empty">No notes here yet.</p> : visible.map(n => <button className={`message-row ${draft?.id === n.id ? 'selected' : ''}`} key={n.id} onClick={() => select(n)}><strong>{n.pinned && <Pin size={12}/>} {n.title}</strong><span>{n.content.slice(0, 100) || 'Empty note'}</span><small>{!n.is_owner ? `${n.owner_name} · ${n.can_edit ? 'Can edit' : 'View only'} · ` : ''}{showTime(n.updated_at)}</small></button>)}
    </section>
    <section className="workspace-reader">
      {!draft ? <div className="reader-empty"><FileText size={32}/><h3>Select a note</h3>{error && <p role="alert">{error}</p>}</div> : <>
        <div className="reader-toolbar"><button className="icon-button" title="Back to notes" aria-label="Back to notes" onClick={() => select(null)}><ArrowLeft size={18}/></button><span className="save-state">{dirty ? 'Unsaved changes' : draft.id ? 'Saved' : 'New note'}{!draft.can_edit && ' · View only'}</span><div className="button-row">
          <button className="icon-button" title="Download note" aria-label="Download note" onClick={download}><Download size={17}/></button>
          {draft.is_owner && <button className={`icon-button ${draft.pinned ? 'is-pinned' : ''}`} title="Pin note" aria-label="Pin note" aria-pressed={draft.pinned} onClick={() => change({ pinned: !draft.pinned })}><Pin size={17}/></button>}
          {draft.id && draft.is_owner && <button className="icon-button" title="Version history" aria-label="Version history" onClick={showHistory}><History size={17}/></button>}
          {draft.id && draft.is_owner && <><button className="icon-button" title="Share note" aria-label="Share note" disabled={dirty} onClick={() => setSharing(true)}><Share2 size={17}/></button><button className="icon-button" title="Delete note" aria-label="Delete note" disabled={busy} onClick={remove}><Trash2 size={17}/></button></>}
          {draft.can_edit && <button className="button primary" disabled={busy || !draft.title.trim() || (!dirty && draft.id)} onClick={save}><Save size={16}/>{busy ? 'Saving...' : 'Save'}</button>}
        </div></div>
        {error && <div className="form-error" role="alert">{error}{draft.id && <button className="button ghost" onClick={async () => { if (await leave()) { try { setDraft((await load()).find(n => n.id === draft.id) || null); setDirty(false); setError('') } catch (err) { setError(err.message) } } }}><RefreshCw size={15}/>Reload latest</button>}</div>}
        <input className="note-title" aria-label="Note title" placeholder="Note title" maxLength={160} readOnly={!draft.can_edit} value={draft.title} onChange={e => change({ title: e.target.value })}/>
        {draft.is_owner && <label className="note-folder-picker">Folder<select aria-label="Note folder" value={draft.folder_id || ''} onChange={e => change({ folder_id: e.target.value ? Number(e.target.value) : null })}><option value="">Unfiled</option>{folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>}
        <textarea className="note-content" aria-label="Note content" placeholder="Write a note..." maxLength={100000} readOnly={!draft.can_edit} value={draft.content} onChange={e => change({ content: e.target.value })}/>
        <div className="reader-footer">{draft.content.trim() ? draft.content.trim().split(/\s+/).length : 0} words<span>{draft.updated_at && `Updated ${showTime(draft.updated_at)}`}</span></div>
      </>}
    </section>
    <Modal open={!!folderEdit} onClose={() => setFolderEdit(null)} title={folderEdit?.id ? 'Rename folder' : 'New folder'}><form className="stack gap-16" onSubmit={saveFolder}><label className="field"><span>Folder name</span><input required maxLength={80} value={folderEdit?.name || ''} onChange={e => setFolderEdit(f => ({ ...f, name: e.target.value }))}/></label><button className="button primary" disabled={busy || !folderEdit?.name.trim()}>Save folder</button></form></Modal>
    <Modal open={sharing} onClose={() => setSharing(false)} title="Share note"><form onSubmit={share} className="stack gap-16"><label className="field"><span>Account email</span><input required type="email" value={invite.email} onChange={e => setInvite({ ...invite, email: e.target.value })}/></label><label className="field"><span>Permission</span><select value={invite.permission} onChange={e => setInvite({ ...invite, permission: e.target.value })}><option value="view">Can view</option><option value="edit">Can edit</option></select></label><button disabled={busy} className="button primary">Share note</button></form><div className="note-shares">{draft?.shares?.map(s => <div key={s.id}><span>{s.email}<small>{s.permission === 'edit' ? 'Can edit' : 'Can view'}</small></span><button className="icon-button" title="Remove access" aria-label={`Remove ${s.email}`} onClick={() => unshare(s)}><Trash2 size={16}/></button></div>)}</div></Modal>
    <Modal open={historyOpen} onClose={() => setHistoryOpen(false)} title="Version history"><div className="note-history">{!history.length ? <p className="muted">No earlier versions yet.</p> : history.map(item => <article key={item.id}><div><strong>Version {item.version}</strong><small>{showTime(item.created_at)}</small></div><p>{item.content || 'Empty note'}</p></article>)}</div></Modal>
  </div>
}
