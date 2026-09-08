import { useEffect, useRef, useState } from 'react'
import Modal from './Modal'
import PasswordInput from './PasswordInput'
import { api, jsonBody } from '../lib/api'

export default function SecurityPrompt() {
  const pending = useRef([])
  const [open,setOpen] = useState(false)
  const [password,setPassword] = useState('')
  const [error,setError] = useState('')
  const [busy,setBusy] = useState(false)
  useEffect(() => {
    const ask = event => { pending.current.push(event.detail); setError(''); setOpen(true) }
    window.addEventListener('flowbudget:confirm-password',ask)
    return () => { window.removeEventListener('flowbudget:confirm-password',ask); pending.current.splice(0).forEach(p=>p.reject(new Error('Confirmation cancelled'))) }
  },[])
  const close = () => { if(busy)return; pending.current.splice(0).forEach(p=>p.reject(new Error('Action cancelled'))); setOpen(false);setPassword('') }
  const submit = async event => {
    event.preventDefault();if(busy)return;setBusy(true);setError('')
    try {await api('/api/account/confirm',{method:'POST',...jsonBody({password})});pending.current.splice(0).forEach(p=>p.resolve());setOpen(false);setPassword('')}
    catch(e){setError(e.message)}finally{setBusy(false)}
  }
  return <Modal open={open} onClose={close} title="Confirm your identity"><form data-reauth="true" onSubmit={submit} className="stack gap-16"><label className="field"><span>Current password</span><PasswordInput required autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}/></label>{error&&<p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="button ghost" disabled={busy} onClick={close}>Cancel</button><button className="button primary" disabled={busy}>{busy?'Confirming...':'Confirm'}</button></div></form></Modal>
}
