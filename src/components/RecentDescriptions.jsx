import { useId, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { recentEntries, useWorkspacePreferences } from '../lib/workspacePreferences'

export default function RecentDescriptions({ userId, scope, type, value, onChange, disabled }) {
  const id = useId()
  const input = useRef(null)
  const [prefs] = useWorkspacePreferences(userId)
  const [focused, setFocused] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const query = String(value || '').trim().toLocaleLowerCase()
  const entries = prefs.descriptionSuggestions ? [...new Set(recentEntries(userId,scope).filter(entry => entry.type === type).map(entry => entry.description).filter(Boolean))]
    .filter(description => description.toLocaleLowerCase().includes(query) && description.toLocaleLowerCase() !== query).slice(0,3) : []
  const visible = focused && !dismissed && !disabled && entries.length > 0
  return <div className="description-field" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false) }}>
    <label className="field" htmlFor={id}><span>Description</span><input ref={input} id={id} autoComplete="off" maxLength="160" disabled={disabled} value={value} onChange={event => onChange(event.target.value)} onFocus={() => {setFocused(true);setDismissed(false)}} onKeyDown={event => {
      if (event.key === 'Escape' && visible) { event.preventDefault(); event.stopPropagation(); setDismissed(true) }
    }} placeholder="What was this for?"/></label>
    {visible && <div className="description-suggestions" role="group" aria-label="Recent descriptions">
      <div className="description-suggestion-items">{entries.map(description => <button key={description} type="button" className="description-suggestion" title={description} aria-label={`Use description ${description}`} onPointerDown={event => event.preventDefault()} onClick={() => {onChange(description);input.current?.focus({preventScroll:true});setDismissed(true)}}>{description}</button>)}</div>
      <button type="button" className="icon-button suggestion-dismiss" aria-label="Hide description suggestions" title="Hide suggestions" onPointerDown={event => event.preventDefault()} onClick={() => {input.current?.focus({preventScroll:true});setDismissed(true)}}><X size={16}/></button>
    </div>}
  </div>
}
