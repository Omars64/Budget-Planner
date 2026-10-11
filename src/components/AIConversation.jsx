import { ArrowUp, Check, Copy, Globe, LoaderCircle, NotebookPen, RefreshCw, Sparkles, ThumbsDown, ThumbsUp } from 'lucide-react'

const prompts = [
  'Create a roadmap to reduce my spending across categories.',
  'Where did my money go this month?',
  'Help me plan my savings and debt repayments.',
  'How do I share a wallet in Budgetly?',
]
const human = key => key.replaceAll('_', ' ').replace(/^./, char => char.toUpperCase())
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

function TransactionDraftCard({ draft, shared, canUse, onUse }) {
  const details = [
    ['Type', human(draft.type || 'transaction')],
    ['Amount', draft.amount || 'Needs amount'],
    ['Description', draft.description || 'No description'],
    ['Wallet', draft.wallet_name || 'Needs wallet'],
    [draft.type === 'transfer' ? 'To wallet' : 'Category', draft.type === 'transfer' ? (draft.transfer_wallet_name || 'Needs destination wallet') : (draft.category_name || 'Needs category')],
    ['Date', draft.date ? new Date(`${draft.date}:00+03:00`).toLocaleString(undefined, { timeZone: 'Asia/Kuwait', dateStyle: 'medium', timeStyle: 'short' }) : 'Needs date'],
  ]
  return <section className="ai-proposal ai-draft" aria-label="Transaction draft">
    <div>
      <strong>Transaction draft</strong>
      <small>Review every field. Nothing has been recorded.</small>
      <dl className="ai-review-fields">{details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      {draft.missing?.length > 0 && <p className="form-note">Choose {draft.missing.join(' and ')} before saving.</p>}
      {shared && !canUse && <p className="form-note">You have view-only access to this shared wallet, so the draft cannot be saved here.</p>}
    </div>
    <button className="button primary small" type="button" disabled={!canUse} onClick={() => onUse(draft)}>{shared ? (canUse ? 'Review shared transaction' : 'View-only access') : 'Review in Transactions'}</button>
  </section>
}

export default function AIConversation({ chat, loading, sending, pending, acting, selectedScope, selectedWallet, wallets, messagesRef, onPrompt, onEarlier, onRetry, onUseDraft, onSource, onSaveNote, onFeedback, notify }) {
  const lastTurn = chat?.turns?.at(-1)
  return <div className="ai-messages" ref={messagesRef} role="log" aria-label="Conversation" aria-live="polite" aria-relevant="additions">
        {loading && <p role="status"><LoaderCircle size={17} className="ai-spinner"/> Loading conversation...</p>}
        {!loading && !chat?.turns?.length && <div className="ai-welcome"><Sparkles size={29}/><h2>What would you like to figure out?</h2><div className="ai-welcome-prompts">{prompts.map(text => <button key={text} onClick={() => { onPrompt(text) }}>{text}<ArrowUp size={16}/></button>)}</div></div>}
        {chat?.has_more && <button className="button ghost small" onClick={onEarlier}>Earlier messages</button>}
        {chat?.turns?.map(turn => <article className="ai-turn" key={turn.id}>
          <p className="ai-user-message" dir="auto">{turn.question}</p>
          <div className="ai-answer">
             <div className="ai-answer-label"><Sparkles size={15}/><strong>{turn.provider && turn.provider !== 'built-in' ? 'Budgetly · AI' : 'Budgetly'}</strong><time dateTime={turn.created_at}>{new Date(turn.created_at).toLocaleString(undefined, { timeZone: 'Asia/Kuwait', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time></div>
            {turn.notice && <p className="ai-response-notice">{turn.notice}</p>}
            {turn.status === 'pending' && <p className="ai-thinking" role="status"><LoaderCircle className="ai-spinner" size={17}/>Working on your question...</p>}
            {['failed', 'stopped'].includes(turn.status) && <div className="ai-answer-error"><p>{turn.error || 'Response stopped. Your question is saved.'}</p><button className="button ghost small" disabled={pending} onClick={event => onRetry(event, turn.id)}><RefreshCw size={16}/>Retry</button></div>}
            {turn.answer && <><Answer text={turn.answer}/>
              {turn.drafts?.map((draft, index) => <TransactionDraftCard key={`${turn.id}-draft-${index}`} draft={draft} shared={selectedScope === 'shared'} canUse={selectedScope !== 'shared' || ['add', 'edit'].includes(wallets?.find(wallet => wallet.id === Number(selectedWallet))?.permission)} onUse={onUseDraft}/>)}
              {!!turn.sources.length && <details className="ai-sources"><summary>Sources & records ({turn.sources.length})</summary>{turn.sources.map(ref => ref.url ? <a key={ref.key} href={safeUrl(ref.url)} target="_blank" rel="noopener noreferrer"><Globe size={14}/>{ref.label}</a> : <button key={ref.key} onClick={() => onSource(ref)}>{ref.label}</button>)}</details>}
              <div className="ai-answer-tools"><button className="icon-button" title="Copy answer" aria-label="Copy answer" onClick={async () => { try { await globalThis.navigator.clipboard.writeText(turn.answer); notify('Answer copied') } catch { notify('Clipboard is unavailable on this device.', 'error') } }}><Copy size={16}/></button><button className="icon-button" title={turn.note_id ? 'Saved to Notes' : 'Save to Notes'} aria-label="Save answer to Notes" disabled={acting || Boolean(turn.note_id)} onClick={() => onSaveNote(turn)}>{turn.note_id ? <Check size={16}/> : <NotebookPen size={16}/>}</button><button className="icon-button" title="Helpful" aria-label="Helpful answer" aria-pressed={turn.feedback === 'helpful'} disabled={acting} onClick={() => onFeedback(turn, 'helpful')}><ThumbsUp size={16}/></button><button className="icon-button" title="Report incorrect answer" aria-label="Report incorrect answer" aria-pressed={turn.feedback === 'incorrect'} disabled={acting} onClick={() => onFeedback(turn, 'incorrect')}><ThumbsDown size={16}/></button></div>
              {turn.id === lastTurn?.id && !!turn.suggestions?.length && <div className="ai-followups">{turn.suggestions.map(text => <button key={text} disabled={pending} onClick={() => { onPrompt(text) }}>{text}</button>)}</div>}
            </>}
          </div>
        </article>)}
        {sending && !chat?.turns?.some(t => t.status === 'pending') && <p className="ai-thinking" role="status"><LoaderCircle className="ai-spinner" size={17}/>Sending your question...</p>}
      </div>
}
