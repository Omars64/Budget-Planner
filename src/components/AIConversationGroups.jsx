import { useCallback, useEffect, useRef, useState } from 'react'
import { Folder, Plus, Settings2 } from 'lucide-react'
import { api, jsonBody } from '../lib/api'
import { useApp } from '../App'
import Modal from './Modal'

export default function AIConversationGroups({ groups, onGroups, selected, onSelect, disabled }) {
  const { notify, confirm } = useApp()
  const [editor, setEditor] = useState(null)
  const [saving, setSaving] = useState(false)
  const notifyRef = useRef(notify)
  const loadRequest = useRef(0)
  useEffect(() => { notifyRef.current = notify }, [notify])
  const load = useCallback(async () => {
    const request = ++loadRequest.current
    const data = await api('/api/ai/groups')
    if (request === loadRequest.current) onGroups(data.items)
  }, [onGroups])
  useEffect(() => {
    let active = true
    const request = ++loadRequest.current
    api('/api/ai/groups').then(data => { if (active && request === loadRequest.current) onGroups(data.items) }).catch(error => { if (active) notifyRef.current(error.message, 'error') })
    return () => { active = false; ++loadRequest.current }
  }, [onGroups])
  const save = async event => {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    try {
      await api('/api/ai/groups' + (editor.id ? '/' + editor.id : ''), {
        method: editor.id ? 'PATCH' : 'POST', ...jsonBody({ name: editor.name, memory_mode: editor.memory_mode, context: editor.context }),
      })
      await load()
      setEditor(null)
    } catch (error) { notify(error.message, 'error') }
    finally { setSaving(false) }
  }
  const remove = async () => {
    if (saving || !await confirm('Delete this group? Its conversations will be kept ungrouped and use General context.')) return
    setSaving(true)
    try {
      await api('/api/ai/groups/' + editor.id, { method: 'DELETE' })
      await load()
      onSelect('', true)
      setEditor(null)
    } catch (error) { notify(error.message, 'error') }
    finally { setSaving(false) }
  }
  return <>
    <div className="ai-groups" aria-label="Conversation groups">
      <div className="ai-group-heading"><strong>Groups</strong><button className="icon-button" title="New group" aria-label="New group" disabled={disabled} onClick={() => setEditor({ name: '', memory_mode: 'group', context: '' })}><Plus size={17}/></button></div>
      <button className="ai-group-select" aria-pressed={selected === ''} onClick={() => onSelect('')}>All conversations</button>
      {groups.map(group => <div className="ai-group-row" key={group.id}>
        <button className="ai-group-select" aria-pressed={selected === group.id} onClick={() => onSelect(group.id)}><Folder size={16}/><span>{group.name}<small>{group.memory_mode === 'group' ? 'Group-only context' : 'General context'}</small></span></button>
        <button className="icon-button" title="Group settings" aria-label={`Settings for ${group.name}`} disabled={disabled} onClick={() => setEditor({ ...group })}><Settings2 size={15}/></button>
      </div>)}
    </div>
    <Modal open={Boolean(editor)} onClose={() => { if (!saving) setEditor(null) }} title={editor?.id ? 'Group settings' : 'New group'}>
      <form className="stack gap-16" onSubmit={save}>
        <label className="field"><span>Group name</span><input required maxLength={80} value={editor?.name || ''} onChange={e => setEditor(v => ({ ...v, name: e.target.value }))}/></label>
        <label className="field"><span>Memory / context</span><select value={editor?.memory_mode || 'group'} onChange={e => setEditor(v => ({ ...v, memory_mode: e.target.value }))}><option value="group">Group-only</option><option value="general">General</option></select></label>
        <p className="muted small">{editor?.memory_mode === 'general' ? 'May reference ungrouped chats and other General groups. Group-only chats stay excluded.' : 'References only conversations within this group.'} Wallet access and selected months stay separate. Memory is used when AI is enabled; built-in guidance does not recall earlier chats.</p>
        <label className="field"><span>Group context (optional)</span><textarea rows={3} maxLength={2000} value={editor?.context || ''} onChange={e => setEditor(v => ({ ...v, context: e.target.value }))}/></label>
        <div className="modal-actions">{editor?.id && <button type="button" className="button ghost danger" disabled={saving} onClick={remove}>Delete group</button>}<button className="button primary" disabled={saving}>{saving ? 'Saving...' : 'Save group'}</button></div>
      </form>
    </Modal>
  </>
}
