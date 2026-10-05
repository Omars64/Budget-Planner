import { useEffect, useRef, useState } from 'react'
import { api, jsonBody } from '../lib/api'
import { openGoogleFlow, reserveGoogleWindow } from '../lib/googleFlow'
import GoogleMark from './GoogleMark'

export default function GoogleSignIn({onLogin,disabled=false,onBusyChange,mode='signin',onComplete}) {
  const [enabled,setEnabled]=useState(false)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [pending,setPending]=useState(null)
  const [name,setName]=useState('')
  const controller=useRef(null)
  const flowSecret=useRef(null)
  const mounted=useRef(true)
  useEffect(()=>{
    mounted.current=true
    const abort=new AbortController()
    api('/api/auth/google/config',{signal:abort.signal}).then(value=>setEnabled(value.enabled === true)).catch(()=>{})
    return ()=>{mounted.current=false;abort.abort();controller.current?.abort();if(flowSecret.current)void api('/api/auth/google/cancel',{method:'POST',...jsonBody({poll_secret:flowSecret.current})}).catch(()=>{})}
  },[])
  const setWorking=value=>{if(mounted.current){setBusy(value);onBusyChange?.(value)}}
  const cancel=()=>{controller.current?.abort();if(flowSecret.current)void api('/api/auth/google/cancel',{method:'POST',...jsonBody({poll_secret:flowSecret.current})}).catch(()=>{});flowSecret.current=null;setPending(null);setName('');setError('');setWorking(false)}
  const start=async()=>{
    if(busy||disabled)return
    let popup
    try {
      popup=reserveGoogleWindow();setError('');setWorking(true)
      const abort=new AbortController();controller.current=abort
      const flow=await api('/api/auth/google/start',{method:'POST',...jsonBody({mode}),signal:abort.signal})
      flowSecret.current=flow.poll_secret
      const result=await openGoogleFlow(flow,{popup,signal:abort.signal,pollPath:'/api/auth/google/poll',pollBody:{poll_secret:flow.poll_secret}})
      if(!mounted.current||abort.signal.aborted)return
      if(result.status==='name_required')setPending(flow)
      else if(result.status==='complete'&&result.token){flowSecret.current=null;await onLogin(result)}
      else if(['linked','reauthenticated'].includes(result.status)){flowSecret.current=null;await onComplete?.(result)}
      else throw new Error(result.status==='link_required'?'This email already has a Budgetly account. Sign in with your existing method, then link Google in Account security.':'Google sign-in was not completed. Please try again.')
    }catch(err){popup?.close();if(mounted.current&&err.name!=='AbortError')setError(err.message)}
    finally{setWorking(false)}
  }
  const complete=async event=>{
    event.preventDefault();if(busy||!pending)return
    setWorking(true);setError('')
    try{
      const result=await api('/api/auth/google/complete-name',{method:'POST',...jsonBody({poll_secret:pending.poll_secret,preferred_name:name.trim()})})
      flowSecret.current=null
      if(mounted.current)await onLogin(result)
    }catch(err){if(mounted.current)setError(err.message)}finally{setWorking(false)}
  }
  if(!enabled)return null
  return <div className="google-flow-status">
    {pending?<form className="auth-form" onSubmit={complete}>
      <label className="auth-entry"><span>Your name in Budgetly</span><input required autoComplete="name" minLength={1} maxLength={80} value={name} onChange={event=>setName(event.target.value)} placeholder="Preferred name" disabled={busy}/></label>
      <button className="button primary full" disabled={busy||!name.trim()}>{busy?'Creating account...':'Create Google account'}</button>
      <button type="button" className="auth-switch" disabled={busy} onClick={cancel}>Cancel</button>
    </form>:<button type="button" className="google-signin" aria-label={busy?'Waiting for Google...':mode==='link'?'Link Google':mode==='reauth'?'Confirm with Google':'Continue with Google'} disabled={disabled||busy} onClick={start}><GoogleMark/>{busy?'Waiting for Google...':mode==='link'?'Link Google':mode==='reauth'?'Confirm with Google':'Continue with Google'}</button>}
    {busy&&!pending&&<><p className="muted" role="status">Finish in your browser, then return to Budgetly.</p><button type="button" className="auth-switch" onClick={cancel}>Cancel Google sign-in</button></>}
    {error&&<p role="alert" className="form-error">{error}</p>}
  </div>
}
