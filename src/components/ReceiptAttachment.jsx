import { useEffect, useRef, useState } from 'react'
import { Camera, ImagePlus, Save, Trash2 } from 'lucide-react'
import { api, jsonBody } from '../lib/api'
import { receiptImage } from '../lib/receiptImage'
import { useApp } from '../App'

export default function ReceiptAttachment({transactionId,onDirty,shared=false,readOnly=false}) {
  const {isGuest,confirm}=useApp()||{}
  const [open,setOpen]=useState(false),[saved,setSaved]=useState(null),[draft,setDraft]=useState(null)
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('')
  const camera=useRef(null),file=useRef(null),active=useRef(false),generation=useRef(0)
  const path=`/api/${shared?'shared/':''}transactions/${transactionId}/receipt`
  useEffect(()=>{if(!open||isGuest)return;const controller=new AbortController();setBusy(true);setError('');api(path,{signal:controller.signal}).then(value=>{if(!controller.signal.aborted)setSaved(value)}).catch(failure=>{if(!controller.signal.aborted)setError(failure.message)}).finally(()=>{if(!controller.signal.aborted)setBusy(false)});return()=>controller.abort()},[open,path,isGuest])
  useEffect(()=>()=>{generation.current++},[])
  useEffect(()=>{onDirty?.(Boolean(draft)||busy);return()=>onDirty?.(false)},[draft,busy,onDirty])
  if(isGuest)return null
  async function choose(event){
    const selected=event.target.files?.[0];event.target.value='';if(!selected||active.current)return
    const version=generation.current;active.current=true;setBusy(true);setError('');setMessage('')
    try{const result=await receiptImage(selected);if(version===generation.current)setDraft(result)}catch(failure){if(version===generation.current)setError(failure.message)}finally{active.current=false;if(version===generation.current)setBusy(false)}
  }
  async function save(){
    if(active.current||!draft||readOnly)return;active.current=true;setBusy(true);setError('')
    try{const result=await api(path,{method:'PUT',...jsonBody(draft)});setSaved(result);setDraft(null);setMessage('Receipt saved.')}catch(failure){setError(failure.message)}finally{active.current=false;setBusy(false)}
  }
  async function remove(){
    if(active.current||readOnly)return
    if(!await confirm('Remove this receipt? Export a backup first to keep a copy.'))return
    active.current=true;setBusy(true);setError('')
    try{await api(path,{method:'DELETE'});setSaved(null);setDraft(null);setMessage('Receipt removed.')}catch(failure){setError(failure.message)}finally{active.current=false;setBusy(false)}
  }
  return <details onToggle={event=>setOpen(event.currentTarget.open)}><summary>Receipt</summary><div className="stack gap-12" aria-busy={busy}>
    {(draft||saved)&&<img className="receipt-photo" src={(draft||saved).image} alt="Attached receipt"/>}
    <input hidden ref={camera} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={choose}/>
    <input hidden ref={file} type="file" accept="image/jpeg,image/png,image/webp" onChange={choose}/>
    {!readOnly&&<div className="button-row"><button type="button" className="button ghost" disabled={busy} onClick={()=>camera.current?.click()}><Camera size={17}/>Take photo</button><button type="button" className="button ghost" disabled={busy} onClick={()=>file.current?.click()}><ImagePlus size={17}/>Choose photo</button>
      {draft&&<><button type="button" className="button primary" disabled={busy} onClick={save}><Save size={17}/>Save receipt</button><button type="button" className="button ghost" disabled={busy} onClick={()=>setDraft(null)}>Discard photo</button></>}
      {saved&&<button type="button" className="icon-button danger" disabled={busy} title="Remove receipt" aria-label="Remove receipt" onClick={remove}><Trash2 size={17}/></button>}
    </div>}
    {readOnly&&!saved&&!busy&&<p className="muted">No reference image attached.</p>}
    {busy&&<p role="status">Processing receipt...</p>}{error&&<p role="alert" className="form-error">{error}</p>}{message&&<p role="status">{message}</p>}
  </div></details>
}
