import { useEffect, useState } from 'react'
import { Star } from 'lucide-react'
import Modal from './Modal'
import { api, jsonBody } from '../lib/api'
import { useApp } from '../App'
import '../feedback-prompt.css'

export default function FeedbackPrompt({ onReady, signoutRequested, onSignoutComplete }) {
  const { user, notify } = useApp()
  const [open, setOpen] = useState(false)
  const [stars, setStars] = useState(0)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let active=true
    api('/api/feedback/prompt').then(result => {if(active&&result.show)setOpen(true)}).catch(()=>{})
    return ()=>{active=false}
  }, [user.id])
  useEffect(() => {
    if (!signoutRequested) return
    api('/api/feedback/prompt').then(result => {
      if (result.show_after_next_event) setOpen(true)
      else onSignoutComplete()
    }).catch(()=>onSignoutComplete())
  }, [signoutRequested, onSignoutComplete])
  useEffect(() => { onReady?.(open) }, [open, onReady])
  const close = async () => {
    if (busy) return
    setOpen(false)
    try { await api(`/api/feedback/prompt/dismiss${signoutRequested?'?next_event=true':''}`,{method:'POST'}) } catch { /* A later sign-in can offer the prompt again. */ }
    if (signoutRequested) onSignoutComplete()
  }
  const send = async event => {
    event.preventDefault()
    if (!stars || busy) return
    setBusy(true);setError('')
    try {await api('/api/feedback/rating',{method:'POST',...jsonBody({stars,comment})});setOpen(false);notify('Thanks for your feedback');if(signoutRequested)onSignoutComplete()}
    catch(err){setError(err.message)}finally{setBusy(false)}
  }
  return <Modal open={open} onClose={close} title="How is Budgetly working for you?" size="small"><form className="stack gap-16" onSubmit={send}><div className="feedback-stars" role="group" aria-label="Rate Budgetly from one to five stars">{[1,2,3,4,5].map(value=><button key={value} type="button" aria-label={`${value} star${value>1?'s':''}`} aria-pressed={stars===value} onClick={()=>setStars(value)}><Star size={29} fill={value<=stars?'currentColor':'none'}/></button>)}</div><label className="field"><span>Anything else? (optional)</span><textarea value={comment} maxLength={2000} rows={4} onChange={event=>setComment(event.target.value)} placeholder="Tell us what could be better"/></label>{error&&<p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="button ghost" onClick={close}>Not now</button><button className="button primary" disabled={!stars||busy}>{busy?'Sending...':'Send rating'}</button></div></form></Modal>
}
