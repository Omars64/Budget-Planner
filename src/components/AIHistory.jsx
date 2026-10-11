import { ChevronLeft, ChevronRight, MessageCircle, Pencil, Trash2 } from 'lucide-react'
import AIConversationGroups from './AIConversationGroups'

export default function AIHistory({ chats, groups, onGroups, selectedGroup, onSelectGroup, chatId, acting, pending, sending, hasChats, historyCollapsed, historyOpen, onToggle, onSelectChat, onRename, onRemove, onLoadMore }) {
  const list = <div className="ai-chat-list">
    <AIConversationGroups groups={groups} onGroups={onGroups} selected={selectedGroup} onSelect={onSelectGroup} disabled={acting || pending}/>
    {!chats.length && <p className="muted">No saved conversations yet.</p>}
    {selectedGroup && !chats.some(item => item.group_id === selectedGroup) && <p className="muted small">No conversations loaded in this group.</p>}
    {chats.filter(item => !selectedGroup || item.group_id === selectedGroup).map(item => <div key={item.id} className={`ai-history-item ${chatId === item.id ? 'selected' : ''}`}>
      <button disabled={!item.accessible || sending} onClick={() => { onSelectChat(item.id) }}><MessageCircle size={16}/><span>{item.title}<small>{item.scope === 'general' ? 'General & economy' : item.scope === 'shared' ? 'Shared wallet' : 'Personal'} · {item.month}</small></span></button>
      <div className="ai-history-actions"><button className="icon-button" title="Edit conversation" aria-label={'Rename ' + item.title} disabled={acting || pending || !item.accessible} onClick={() => onRename({ ...item })}><Pencil size={14}/></button><button className="icon-button danger" title="Delete conversation" aria-label={'Delete ' + item.title} disabled={acting} onClick={() => onRemove(item)}><Trash2 size={14}/></button></div>
    </div>)}
    {hasChats && <button className="button ghost" onClick={() => onLoadMore()}>Older conversations</button>}
  </div>
  return <aside className="ai-history" id="conversation-history"><div className="ai-history-head"><h3>Conversations</h3><button className="icon-button ai-history-toggle" title={historyCollapsed ? 'Expand conversations' : 'Collapse conversations'} aria-label="Toggle conversations" aria-expanded={!historyCollapsed || historyOpen} aria-controls="conversation-history" onClick={onToggle}>{historyCollapsed ? <ChevronRight size={22}/> : <ChevronLeft size={22}/>}</button></div>{list}</aside>
}
