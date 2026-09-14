import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowUp, Check, ChevronDown, Copy, Globe, LoaderCircle, MessageCircle, NotebookPen, PanelLeftClose, PanelLeftOpen, Pencil, Plus, RefreshCw, Settings2, Sparkles, Square, ThumbsDown, ThumbsUp, Trash2, X } from 'lucide-react'
import { api, jsonBody } from '../lib/api'
import { dateInput } from '../lib/time'
import { useApp } from '../App'
import Modal from '../components/Modal'

const prompts = [
  'Create a roadmap to reduce my spending across categories.',
  'Where did my money go this month?',
  'Help me plan my savings and debt repayments.',
  'How do I share a wallet in Budgetly?',
]
const human = key => key.replaceAll('_', ' ').replace(/^./, char => char.toUpperCase())
const readable = value => value == null ? 'None' : typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)
const safeUrl = value => { try { return new URL(value).protocol === 'https:' ? value : '' } catch { return '' } }

function inlineText(value) {
  const parts = String(value).split(/(\*\*[^*]+\*\*|`[^`]+`|https?:\/\/[^\s)]+)/g)
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>
    if (/^https?:\/\//.test(part)) return safeUrl(part) ? <a key={index} href={part} target="_blank" rel="noopener noreferrer">{part}</a> : part
    return <span key={index}>{part}</span>
  })
}

function Answer({ text }) {
  const blocks = String(text).split(/\n{2,}/).map(block => block.trim()).filter(Boolean)
  return <div className="ai-markdown">{blocks.map((block, index) => {
    const lines = block.split('\n').map(line => line.trim()).filter(Boolean)
    const list = lines.length > 0 && lines.every(line => /^[-*]\s+/.test(line))
    if (list) return <ul key={index}>{lines.map((line, item) => <li key={item}>{inlineText(line.replace(/^[-*]\s+/, ''))}</li>)}</ul>
    const heading = lines.length === 1 && /^(#{1,4})\s+/.test(lines[0])
    if (heading) return <h3 key={index}>{inlineText(lines[0].replace(/^#{1,4}\s+/, ''))}</h3>
    return <p key={index}>{lines.map((line, lineIndex) => <span key={lineIndex}>{lineIndex > 0 && <br/>}{inlineText(line)}</span>)}</p>
  })}</div>
}

export default function AskAI() {
  const { notify, confirm, refresh } = useApp()
  const location = useLocation()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const chatId = params.get('chat') || ''
  const initial = useRef(location.state || {})
  const [config, setConfig] = useState(null)
  const [chats, setChats] = useState([])
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
  const mounted = useRef(true)
  const messages = useRef(null)
  const composer = useRef(null)
  const selectedScope = chat?.scope || context.scope
  const selectedWallet = chat?.wallet_id ?? context.wallet_id
  const selectedMonth = chat?.month || context.month
  const pending = sending || chat?.turns?.some(turn => turn.status === 'pending')

  const loadChats = useCallback(async (offset = 0) => {
    const data = await api('/api/ai/chats?offset=' + offset)
    if (!mounted.current) return
    setChats(previous => offset ? [...previous, ...data.items] : data.items)
    setHasChats(data.has_more)
  }, [])
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
        const created = await api('/api/ai/chats', { method: 'POST', ...jsonBody({ id: draftId, ...context, wallet_id: context.wallet_id ? Number(context.wallet_id) : null }) })
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
  const wallets = selectedScope === 'shared' ? config?.shared_wallets : config?.wallets
  const label = selectedScope === 'general' ? 'General & economy' : wallets?.find(w => w.id === Number(selectedWallet))?.name || 'My wallets'
  const historyList = <div className="ai-chat-list">
    {!chats.length && <p className="muted">No saved conversations yet.</p>}
    {chats.map(item => <div key={item.id} className={`ai-history-item ${chatId === item.id ? 'selected' : ''}`}>
      <button disabled={!item.accessible || sending} onClick={() => { setParams({ chat: item.id }); setQuestion(''); requestRef.current = null }}><MessageCircle size={16}/><span>{item.title}<small>{item.scope === 'general' ? 'General & economy' : item.scope === 'shared' ? 'Shared wallet' : 'Personal'} · {item.month}</small></span></button>
      <div className="ai-history-actions"><button className="icon-button" title="Rename conversation" aria-label={'Rename ' + item.title} disabled={acting || !item.accessible} onClick={() => setRename({ ...item })}><Pencil size={14}/></button><button className="icon-button danger" title="Delete conversation" aria-label={'Delete ' + item.title} disabled={acting} onClick={() => removeChat(item)}><Trash2 size={14}/></button></div>
    </div>)}
    {hasChats && <button className="button ghost" onClick={() => loadChats(chats.length).catch(err => notify(err.message, 'error'))}>Older conversations</button>}
  </div>

  return <section className={`ai-workspace ${historyCollapsed ? 'history-collapsed' : ''} ${historyOpen ? 'history-mobile-open' : ''}`} aria-label="Ask Budgetly workspace">
    {historyOpen && (
      <button className="ai-history-scrim" aria-label="Close conversations" onClick={() => setHistoryOpen(false)}/>
    )}
    <aside className="ai-history" id="conversation-history"><div className="ai-history-head"><h3>Conversations</h3><button className="icon-button ai-history-toggle" title={historyCollapsed ? 'Expand conversations' : 'Collapse conversations'} aria-label="Toggle conversations" aria-expanded={!historyCollapsed || historyOpen} aria-controls="conversation-history" onClick={toggleHistory}>{historyCollapsed ? <PanelLeftOpen size={20}/> : <PanelLeftClose size={20}/>}</button></div>{historyList}</aside>
    <div className="ai-chat-main">
      <div className="ai-chat-toolbar">
        <button className="ai-context-button" disabled={pending} onClick={() => setContextOpen(true)} title="Choose context for a new conversation"><Settings2 size={16}/><span>{label}{selectedScope !== 'general' && <small>{selectedMonth}</small>}</span><ChevronDown size={14}/></button>
        <span className="ai-mode">{config?.ai_available ? 'AI enabled by admin' : 'Built-in guide'}</span>
        <button className="icon-button" title="New conversation" aria-label="New conversation" disabled={pending} onClick={() => setContextOpen(true)}><Plus size={21}/></button>
      </div>
      <div className="ai-messages" ref={messages} role="log" aria-label="Conversation" aria-live="polite" aria-relevant="additions">
        {loading && <p role="status"><LoaderCircle size={17} className="ai-spinner"/> Loading conversation...</p>}
        {!loading && !chat?.turns?.length && <div className="ai-welcome"><Sparkles size={29}/><h2>What would you like to figure out?</h2><div className="ai-welcome-prompts">{prompts.map(text => <button key={text} onClick={() => { setQuestion(text); composer.current?.focus() }}>{text}<ArrowUp size={16}/></button>)}</div></div>}
        {chat?.has_more && <button className="button ghost small" onClick={async () => { try { const data = await api(`/api/ai/chats/${chatId}?before=${chat.turns[0].id}`); setChat(current => ({ ...current, turns: [...data.turns, ...current.turns], has_more: data.has_more })) } catch (err) { setError(err.message) } }}>Earlier messages</button>}
        {chat?.turns?.map(turn => <article className="ai-turn" key={turn.id}>
          <p className="ai-user-message" dir="auto">{turn.question}</p>
          <div className="ai-answer">
             <div className="ai-answer-label"><Sparkles size={15}/><strong>{turn.provider && turn.provider !== 'built-in' ? 'Budgetly · AI' : 'Budgetly'}</strong><time dateTime={turn.created_at}>{new Date(turn.created_at).toLocaleString(undefined, { timeZone: 'Asia/Kuwait', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time></div>
            {turn.notice && <p className="ai-response-notice">{turn.notice}</p>}
            {turn.status === 'pending' && <p className="ai-thinking" role="status"><LoaderCircle className="ai-spinner" size={17}/>Working on your question...</p>}
            {['failed', 'stopped'].includes(turn.status) && <div className="ai-answer-error"><p>{turn.error || 'Response stopped. Your question is saved.'}</p><button className="button ghost small" disabled={pending} onClick={event => send(event, turn.id)}><RefreshCw size={16}/>Retry</button></div>}
            {turn.answer && <><Answer text={turn.answer}/>
              {!!turn.sources.length && <details className="ai-sources"><summary>Sources & records ({turn.sources.length})</summary>{turn.sources.map(ref => ref.url ? <a key={ref.key} href={safeUrl(ref.url)} target="_blank" rel="noopener noreferrer"><Globe size={14}/>{ref.label}</a> : <button key={ref.key} onClick={() => openSource(ref)}>{ref.label}</button>)}</details>}
              <div className="ai-answer-tools"><button className="icon-button" title="Copy answer" aria-label="Copy answer" onClick={async () => { try { await globalThis.navigator.clipboard.writeText(turn.answer); notify('Answer copied') } catch { notify('Clipboard is unavailable on this device.', 'error') } }}><Copy size={16}/></button><button className="icon-button" title={turn.note_id ? 'Saved to Notes' : 'Save to Notes'} aria-label="Save answer to Notes" disabled={acting || Boolean(turn.note_id)} onClick={() => saveNote(turn)}>{turn.note_id ? <Check size={16}/> : <NotebookPen size={16}/>}</button><button className="icon-button" title="Helpful" aria-label="Helpful answer" aria-pressed={turn.feedback === 'helpful'} disabled={acting} onClick={() => feedback(turn, 'helpful')}><ThumbsUp size={16}/></button><button className="icon-button" title="Report incorrect answer" aria-label="Report incorrect answer" aria-pressed={turn.feedback === 'incorrect'} disabled={acting} onClick={() => feedback(turn, 'incorrect')}><ThumbsDown size={16}/></button></div>
              {turn.id === lastTurn?.id && !!turn.suggestions?.length && <div className="ai-followups">{turn.suggestions.map(text => <button key={text} disabled={pending} onClick={() => { setQuestion(text); composer.current?.focus() }}>{text}</button>)}</div>}
            </>}
          </div>
        </article>)}
        {sending && !chat?.turns?.some(t => t.status === 'pending') && <p className="ai-thinking" role="status"><LoaderCircle className="ai-spinner" size={17}/>Sending your question...</p>}
      </div>
      <div className="ai-composer-zone">
        {error && <p className="ai-error" role="alert">{error}<button title="Dismiss error" aria-label="Dismiss error" onClick={() => setError('')}><X size={15}/></button></p>}
        <form className="ai-composer" onSubmit={send}><textarea ref={composer} rows={1} aria-label="Message Ask Budgetly" placeholder="Ask Budgetly..." value={question} maxLength={8000} onChange={e => setQuestion(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia('(min-width: 821px)').matches) { e.preventDefault(); void send(e) } }}/>{pending ? <button type="button" className="ai-send" title="Stop response" aria-label="Stop response" onClick={stop}><Square size={18}/></button> : <button className="ai-send" title="Send message" aria-label="Send message" disabled={!question.trim() || !config || loading || Boolean(chatId && !chat)}><ArrowUp size={21}/></button>}</form>
        <small>{config?.ai_available ? 'Messages and selected activity are sent to OpenAI. Check important figures.' : 'Built-in guidance · Your selected Budgetly records'}</small>
      </div>
    </div>

    <Modal open={contextOpen} onClose={() => setContextOpen(false)} title="New conversation">
      <form className="stack gap-16" onSubmit={startNew}><label className="field"><span>Answer using</span><select value={context.scope} onChange={e => setContext({ ...context, scope: e.target.value, wallet_id: '' })}><option value="personal">My wallets</option><option value="shared">A shared wallet</option><option value="general">General & economy (no wallet data)</option></select></label>
        {context.scope !== 'general' && <><label className="field"><span>Wallet</span><select required={context.scope === 'shared'} value={context.wallet_id} onChange={e => setContext({ ...context, wallet_id: e.target.value })}><option value="">{context.scope === 'shared' ? 'Choose a shared wallet' : 'All my wallets'}</option>{(context.scope === 'shared' ? config?.shared_wallets : config?.wallets)?.map(w => <option key={w.id} value={w.id}>{w.name}{w.permission ? ' (' + w.permission + ')' : ''}</option>)}</select></label><label className="field"><span>Month</span><input type="month" required min="1900-01" max="9998-12" value={context.month} onChange={e => setContext({ ...context, month: e.target.value })}/></label></>}
        <p className="muted small">Personal and shared records stay separate. Your existing conversation will remain saved.</p><div className="modal-actions"><button type="button" className="button ghost" onClick={() => setContextOpen(false)}>Cancel</button><button className="button primary" disabled={sending}>Start conversation</button></div>
      </form>
    </Modal>
    <Modal open={Boolean(rename)} onClose={() => setRename(null)} title="Rename conversation"><form className="stack gap-16" onSubmit={e => { e.preventDefault(); void mutate(async () => { await api('/api/ai/chats/' + rename.id, { method: 'PATCH', ...jsonBody({ title: rename.title }) }); if (chatId === rename.id) await loadChat(chatId); setRename(null); await loadChats() }) }}><label className="field"><span>Name</span><input required maxLength={120} value={rename?.title || ''} onChange={e => setRename(v => ({ ...v, title: e.target.value }))}/></label><button className="button primary" disabled={acting}>Save name</button></form></Modal>
    <Modal open={Boolean(source)} onClose={() => setSource(null)} title={source?.source?.label || 'Record'}>{source?.loading ? <p>Loading current record...</p> : source && <div className="stack gap-16"><dl className="ai-review-fields">{Object.entries(source.data).filter(([key]) => !key.endsWith('_id') && !['reference', 'id'].includes(key)).map(([key, value]) => <div key={key}><dt>{human(key)}</dt><dd>{readable(value)}</dd></div>)}</dl><button className="button ghost" onClick={() => navigate(source.source.path)}>Open in Budgetly</button></div>}</Modal>
  </section>
}
