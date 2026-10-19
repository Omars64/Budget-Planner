import { FileText, Folder, FolderPlus, Pencil, Pin, Settings2, Share2, Trash2 } from 'lucide-react'
import { useState } from 'react'

export default function NotesFolders({ folders, notes, selected, onSelect, onCreate, onRename, onDelete, canManage, inSpace = false }) {
  const [managing, setManaging] = useState(false)
  const owned = notes.filter(note => inSpace || note.is_owner)
  const count = key => key === 'all' ? owned.length : key === 'pinned' ? owned.filter(note => note.pinned).length : notes.filter(note => !note.is_owner).length
  return <nav className="notes-folder-navigation" aria-label="Note folders">
    <div className="notes-folder-shortcuts">
      {[['all', 'All notes', FileText], ['pinned', 'Pinned', Pin], ...(!inSpace ? [['shared', 'Shared notes', Share2]] : [])].map(([key, label, Icon]) =>
        <button type="button" key={key} className={`folder-link ${selected === key ? 'selected' : ''}`} aria-current={selected === key ? 'page' : undefined} onClick={() => onSelect(key)}>
          <Icon size={20}/><span>{label}</span>{' '}<small>{count(key)}</small>
        </button>)}
    </div>
    <div className="notes-folder-heading"><h4>Folders</h4><button type="button" className="icon-button" title="New folder" aria-label="New folder" disabled={!canManage} onClick={onCreate}><FolderPlus size={20}/></button></div>
    <div className="notes-folder-items">
      {[...folders].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }) || a.id - b.id).map(item => <div className={`notes-folder-item ${managing ? 'is-managing' : ''}`} key={item.id}>
        <button type="button" className={`folder-link ${selected === String(item.id) ? 'selected' : ''}`} aria-current={selected === String(item.id) ? 'page' : undefined} onClick={() => onSelect(String(item.id))}>
          <Folder size={20} style={{ color: item.color }}/><span>{item.name}</span>{' '}<small>{owned.filter(note => note.folder_id === item.id).length}</small>
        </button>
        {managing && <div className="notes-folder-actions"><button type="button" className="icon-button" title={`Rename ${item.name}`} aria-label={`Rename ${item.name}`} onClick={() => onRename(item)}><Pencil size={17}/></button><button type="button" className="icon-button" title={`Delete ${item.name}`} aria-label={`Delete ${item.name}`} onClick={() => onDelete(item)}><Trash2 size={17}/></button></div>}
      </div>)}
      {!folders.length && <p className="notes-no-folders">No folders yet</p>}
    </div>
    {canManage && <button type="button" className="notes-manage-folders" aria-pressed={managing} onClick={() => setManaging(value => !value)}><Settings2 size={18}/>{managing ? 'Done managing' : 'Manage folders'}</button>}
  </nav>
}
