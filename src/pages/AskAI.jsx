import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowUp, ChevronDown, Plus, Settings2, Square, X } from 'lucide-react'
import { api, jsonBody } from '../lib/api'
import { dateInput } from '../lib/time'
import { useApp } from '../App'
import Modal from '../components/Modal'
import AIHistory from '../components/AIHistory'
import AIConversation from '../components/AIConversation'

const human = key => key.replaceAll('_', ' ').replace(/^./, char => char.toUpperCase())
const readable = value => value == null ? 'None' : typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)
export default function AskAI() {
  const { user, notify, confirm, refresh } = useApp()
  const location = useLocation()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const chatId = params.get('chat') || ''
  const initial = useRef(location.state || {})
  const [config, setConfig] = useState(null)
  const [chats, setChats] = useState([])
  const [groups, setGroups] = useState([])
  const [selectedGroup, setSelectedGroup] = useState('')
  const [hasChats, setHasChats] = useState(false)
  const [chat, setChat] = useState(null)
  const [question, setQuestion] = useState(initial.current.question || '')
  const [context, setContext] = useState({ scope: initial.current.scope || 'personal', wallet_id: initial.current.walletId || '', month: initial.current.month || dateInput().slice(0, 7) })
  const [contextOpen, setContextOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyCollapsed, setHistoryCollapsed] = useState(() => {
    try { return window.localStorage.getItem('budgetly-chat-history-collapsed') === 'true' } catch { return false }
  })
  const [rename, setRename] = useState(null)
  const [source, setSource] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [acting, setActing] = useState(false)
  const busyRef = useRef(false)
  const actionRef = useRef(false)
  const selection = useRef(chatId)
  const requestRef = useRef(null)
  const listRequest = useRef(0)
  const mounted = useRef(true)
  const messages = useRef(null)
  const composer = useRef(null)
  const selectedScope = chat?.scope || context.scope
  const selectedWallet = chat?.wallet_id ?? context.wallet_id
  const selectedMonth = chat?.month || context.month
  const pending = sending || chat?.turns?.some(turn => turn.status === 'pending')

  const loadChats = useCallback(async (offset = 0) => {
    const request = ++listRequest.current
    const data = await api('/api/ai/chats?offset=' + offset + (selectedGroup ? '&group_id=' + encodeURIComponent(selectedGroup) : ''))
    if (!mounted.current || request !== listRequest.current) return
    setChats(previous => offset ? [...previous, ...data.items.filter(item => !previous.some(row => row.id === item.id))] : data.items)
    setHasChats(data.has_more)
  }, [selectedGroup])
  const loadChat = useCallback(async id => {
    const data = await api('/api/ai/chats/' + id)
    if (mounted.current && selection.current === id) setChat(data)
    return data
  }, [])
  useEffect(() => {
    mounted.current = true
    const loadConfig = () => api('/api/ai/config').then(data => { if (mounted.current) setConfig(data) }).catch(err => { if (mounted.current) setError(err.message) })
    void loadConfig()
    window.addEventListener('focus', loadConfig)
    const configTimer = window.setInterval(loadConfig, 60000)
    void loadChats().catch(err => setError(err.message))
    const resize = () => document.documentElement.style.setProperty('--ai-viewport', (window.visualViewport?.height || window.innerHeight) + 'px')
    resize()
    window.visualViewport?.addEventListener('resize', resize)
    return () => { mounted.current = false; window.clearInterval(configTimer); window.removeEventListener('focus', loadConfig); window.visualViewport?.removeEventListener('resize', resize); document.documentElement.style.removeProperty('--ai-viewport') }
  }, [loadChats])
  useEffect(() => {
    selection.current = chatId
    setChat(null)
    setError('')
    setHistoryOpen(false)
    if (!chatId) return
    setLoading(true)
    void loadChat(chatId).catch(err => { if (selection.current === chatId) setError(err.message) }).finally(() => { if (selection.current === chatId) setLoading(false) })
  }, [chatId, loadChat])
  useEffect(() => {
    if (!chatId) return
    let checking = false
    const sync = async () => {
      if (checking || document.visibilityState === 'hidden') return
      checking = true
      try { await loadChat(chatId) } catch (err) {
        if (selection.current === chatId) {
          if ([403, 404].includes(err.status)) setChat(null)
          setError(err.message)
        }
      } finally { checking = false }
    }
    const timer = window.setInterval(sync, pending ? 3000 : 30000)
    window.addEventListener('focus', sync)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', sync) }
  }, [chatId, pending, loadChat])
  const lastTurn = chat?.turns?.at(-1)
  useEffect(() => {
    const el = composer.current
    if (el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 112) + 'px' }
  }, [question])
  const toggleHistory = () => {
    if (window.matchMedia('(max-width: 820px)').matches) { setHistoryOpen(value => !value); return }
    setHistoryCollapsed(value => {
      try { window.localStorage.setItem('budgetly-chat-history-collapsed', String(!value)) } catch { /* Storage is optional. */ }
      return !value
    })
  }
  useEffect(() => {
    const openFromHeader = () => {
      if (window.matchMedia('(max-width: 820px)').matches) setHistoryOpen(value => !value)
    }
    window.addEventListener('budgetly:toggle-ai-history', openFromHeader)
    return () => window.removeEventListener('budgetly:toggle-ai-history', openFromHeader)
  }, [])
  useEffect(() => {
    const el = messages.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'instant' })
  }, [lastTurn?.id, lastTurn?.status, sending])

  const send = async (event, retryId = null) => {
    event?.preventDefault()
    if (busyRef.current || (pending && !retryId)) return
    if (!config) { setError('Ask Budgetly is still loading. Please try again in a moment.'); return }
    const text = question.trim()
    if (!retryId && !text) { setError('Enter a question before sending.'); composer.current?.focus(); return }
    busyRef.current = true
    setSending(true)
    setError('')
    let id = chatId
    try {
      if (!id) {
        const draftId = requestRef.current?.chatId || globalThis.crypto.randomUUID()
        requestRef.current = { ...(requestRef.current || {}), chatId: draftId }
        const created = await api('/api/ai/chats', { method: 'POST', ...jsonBody({ id: draftId, ...context, group_id: context.group_id || null, wallet_id: context.wallet_id ? Number(context.wallet_id) : null }) })
        id = created.id
        selection.current = id
        setParams({ chat: id }, { replace: true })
      }
      if (retryId) {
        await api(`/api/ai/turns/${retryId}/retry`, { method: 'POST' })
      } else {
        if (!requestRef.current?.requestId || requestRef.current.question !== text) {
          requestRef.current = { chatId: id, requestId: globalThis.crypto.randomUUID(), question: text }
        }
        const result = await api(`/api/ai/chats/${id}/messages`, { method: 'POST', ...jsonBody({ request_id: requestRef.current.requestId, question: text }) })
        if (result.id) { requestRef.current = null; if (mounted.current && selection.current === id) setQuestion('') }
      }
      await loadChat(id)
      await loadChats()
    } catch (err) {
      if (mounted.current && selection.current === id) {
        setError(err.message)
        if (id) void loadChat(id).catch(() => {})
      }
    } finally { busyRef.current = false; if (mounted.current) setSending(false) }
  }
  const stop = async () => {
    if (!chatId) return
    try { await api(`/api/ai/chats/${chatId}/stop`, { method: 'POST' }); await loadChat(chatId) }
    catch (err) { setError(err.message) }
  }
  const startNew = event => {
    event.preventDefault()
    if (context.scope === 'shared' && !context.wallet_id) { setError('Choose a shared wallet.'); return }
    setContextOpen(false)
    selection.current = ''
    setParams({})
    setChat(null)
    setQuestion('')
    requestRef.current = null
    setError('')
    composer.current?.focus()
  }
  const mutate = async callback => {
    if (actionRef.current) return
    actionRef.current = true
    setActing(true)
    try { await callback() } catch (err) { notify(err.message, 'error') }
    finally { actionRef.current = false; if (mounted.current) setActing(false) }
  }
  const removeChat = async item => {
    if (!await confirm('Delete this conversation? Previously saved Budgetly records will not be deleted.')) return
    await mutate(async () => {
      await api('/api/ai/chats/' + item.id, { method: 'DELETE' })
      if (chatId === item.id) { setParams({}); setChat(null) }
      await loadChats()
    })
  }
  const openSource = async ref => {
    if (ref.url) return
    if (ref.kind && ref.kind !== 'wallet') {
      try { setSource({ loading: true }); const data = await api(`/api/ai/chats/${chatId}/record/${ref.kind}/${ref.id}`); setSource(data) }
      catch (err) { setSource(null); notify(err.message, 'error') }
    } else navigate(ref.path, { state: { aiFilters: { month: ref.month || '', wallet: ref.wallet_id ? String(ref.wallet_id) : '', search: ref.search || '' } } })
  }
  const saveNote = turn => mutate(async () => {
    await api(`/api/ai/turns/${turn.id}/save-note`, { method: 'POST' })
    await loadChat(chatId)
    refresh()
    notify('Answer saved in Notes')
  })
  const feedback = (turn, value) => mutate(async () => {
    await api(`/api/ai/turns/${turn.id}/feedback`, { method: 'PUT', ...jsonBody({ value }) })
    await loadChat(chatId)
    notify(value === 'incorrect' ? 'Answer marked for review' : 'Feedback recorded')
  })
  const useDraft = draft => {
    const shared = selectedScope === 'shared'
    const sharedWallet = wallets?.find(wallet => wallet.id === Number(selectedWallet))
    if (shared && !['add', 'edit'].includes(sharedWallet?.permission)) { notify('You have view-only access to this shared wallet.', 'error'); return }
    const key = `flowbudget_${shared ? 'shared_' : ''}tx_draft_${user.id}`
    const formDraft = {
      type: draft.type || 'expense', amount: draft.amount || '', description: draft.description || '', notes: draft.notes || '',
      date: draft.date || dateInput(), reporting_month: draft.reporting_month || '', wallet_id: draft.wallet_id || '',
      transfer_wallet_id: draft.transfer_wallet_id || '', category_id: draft.category_id || '', recurring_frequency: 'none', recurring_until: '',
    }
    try { sessionStorage.setItem(key, JSON.stringify(formDraft)) } catch { notify('Allow device storage to open the draft in the transaction form.', 'error'); return }
    navigate(shared ? '/shared-transactions' : '/transactions', { state: { aiDraft: true } })
  }
  const wallets = selectedScope === 'shared' ? config?.shared_wallets : config?.wallets
  const label = selectedScope === 'general' ? 'General & economy' : wallets?.find(w => w.id === Number(selectedWallet))?.name || 'My wallets'
  const selectGroup = (id, reload = false) => {
    setSelectedGroup(id)
    setContext(current => ({ ...current, group_id: id }))
    if (reload) { void loadChats().catch(err => notify(err.message, 'error')); if (chatId) void loadChat(chatId).catch(err => setError(err.message)) }
  }


  return <section className={`ai-workspace ${historyCollapsed ? 'history-collapsed' : ''} ${historyOpen ? 'history-mobile-open' : ''}`} aria-label="Ask Budgetly workspace">
    {historyOpen && (
      <button className="ai-history-scrim" aria-label="Close conversations" onClick={() => setHistoryOpen(false)}/>
    )}
    <AIHistory chats={chats} groups={groups} onGroups={setGroups} selectedGroup={selectedGroup} onSelectGroup={selectGroup} chatId={chatId} acting={acting} pending={pending} sending={sending} hasChats={hasChats} historyCollapsed={historyCollapsed} historyOpen={historyOpen} onToggle={toggleHistory} onSelectChat={id => { setParams({ chat: id }); setQuestion(''); requestRef.current = null }} onRename={setRename} onRemove={removeChat} onLoadMore={() => loadChats(chats.length).catch(err => notify(err.message, 'error'))}/>
    <div className="ai-chat-main">
      <div className="ai-chat-toolbar">
        {chat?.group_id && <span className="ai-current-group">{groups.find(group => group.id === chat.group_id)?.name}</span>}
        <button className="ai-context-button" disabled={pending} onClick={() => setContextOpen(true)} title="Choose context for a new conversation"><Settings2 size={16}/><span>{label}{selectedScope !== 'general' && <small>{selectedMonth}</small>}</span><ChevronDown size={14}/></button>
        <span className="ai-mode">{config?.ai_available ? 'AI enabled by admin' : 'Built-in guide'}</span>
        <button className="icon-button" title="New conversation" aria-label="New conversation" disabled={pending} onClick={() => setContextOpen(true)}><Plus size={21}/></button>
      </div>
      <AIConversation chat={chat} loading={loading} sending={sending} pending={pending} acting={acting} selectedScope={selectedScope} selectedWallet={selectedWallet} wallets={wallets} messagesRef={messages} onPrompt={text => { setQuestion(text); composer.current?.focus() }} onEarlier={async () => { try { const data = await api(`/api/ai/chats/${chatId}?before=${chat.turns[0].id}`); setChat(current => ({ ...current, turns: [...data.turns, ...current.turns], has_more: data.has_more })) } catch (err) { setError(err.message) } }} onRetry={send} onUseDraft={useDraft} onSource={openSource} onSaveNote={saveNote} onFeedback={feedback} notify={notify}/>
      <div className="ai-composer-zone">
        {error && <p className="ai-error" role="alert">{error}<button title="Dismiss error" aria-label="Dismiss error" onClick={() => setError('')}><X size={15}/></button></p>}
        <form className="ai-composer" onSubmit={send}><textarea ref={composer} rows={1} aria-label="Message Ask Budgetly" placeholder="Ask Budgetly..." value={question} maxLength={8000} onChange={e => setQuestion(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia('(min-width: 821px)').matches) { e.preventDefault(); void send(e) } }}/>{pending ? <button type="button" className="ai-send" title="Stop response" aria-label="Stop response" onClick={stop}><Square size={18}/></button> : <button className="ai-send" title="Send message" aria-label="Send message" disabled={!question.trim() || !config || loading || Boolean(chatId && !chat)}><ArrowUp size={21}/></button>}</form>
        <small>{config?.ai_available ? 'Messages and selected activity are sent to OpenAI. Check important figures.' : 'Built-in guidance · Your selected Budgetly records'}</small>
      </div>
    </div>

    <Modal open={contextOpen} onClose={() => setContextOpen(false)} title="New conversation">
      <form className="stack gap-16" onSubmit={startNew}><label className="field"><span>Group</span><select value={context.group_id || ''} onChange={e => setContext({ ...context, group_id: e.target.value })}><option value="">Ungrouped</option>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label><label className="field"><span>Answer using</span><select value={context.scope} onChange={e => setContext({ ...context, scope: e.target.value, wallet_id: '' })}><option value="personal">My wallets</option><option value="shared">A shared wallet</option><option value="general">General & economy (no wallet data)</option></select></label>
        {context.scope !== 'general' && <><label className="field"><span>Wallet</span><select required={context.scope === 'shared'} value={context.wallet_id} onChange={e => setContext({ ...context, wallet_id: e.target.value })}><option value="">{context.scope === 'shared' ? 'Choose a shared wallet' : 'All my wallets'}</option>{(context.scope === 'shared' ? config?.shared_wallets : config?.wallets)?.map(w => <option key={w.id} value={w.id}>{w.name}{w.permission ? ' (' + w.permission + ')' : ''}</option>)}</select></label><label className="field"><span>Month</span><input type="month" required min="1900-01" max="9998-12" value={context.month} onChange={e => setContext({ ...context, month: e.target.value })}/></label></>}
        <p className="muted small">Personal and shared records stay separate. Your existing conversation will remain saved.</p><div className="modal-actions"><button type="button" className="button ghost" onClick={() => setContextOpen(false)}>Cancel</button><button className="button primary" disabled={sending}>Start conversation</button></div>
      </form>
    </Modal>
    <Modal open={Boolean(rename)} onClose={() => setRename(null)} title="Edit conversation"><form className="stack gap-16" onSubmit={e => { e.preventDefault(); void mutate(async () => { await api('/api/ai/chats/' + rename.id, { method: 'PATCH', ...jsonBody({ title: rename.title, group_id: rename.group_id || null }) }); if (chatId === rename.id) await loadChat(chatId); setRename(null); await loadChats() }) }}><label className="field"><span>Name</span><input required maxLength={120} value={rename?.title || ''} onChange={e => setRename(v => ({ ...v, title: e.target.value }))}/></label><label className="field"><span>Group</span><select value={rename?.group_id || ''} onChange={e => setRename(v => ({ ...v, group_id: e.target.value }))}><option value="">Ungrouped</option>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label><button className="button primary" disabled={acting}>Save changes</button></form></Modal>
    <Modal open={Boolean(source)} onClose={() => setSource(null)} title={source?.source?.label || 'Record'}>{source?.loading ? <p>Loading current record...</p> : source && <div className="stack gap-16"><dl className="ai-review-fields">{Object.entries(source.data).filter(([key]) => !key.endsWith('_id') && !['reference', 'id'].includes(key)).map(([key, value]) => <div key={key}><dt>{human(key)}</dt><dd>{readable(value)}</dd></div>)}</dl><button className="button ghost" onClick={() => navigate(source.source.path)}>Open in Budgetly</button></div>}</Modal>
  </section>
}
