import { useEffect, useRef, useState } from 'react'
import { Camera, ImagePlus, X } from 'lucide-react'
import { receiptImage } from '../lib/receiptImage'

export default function ReceiptDraft({value,onChange,onBusy,disabled=false,shared=false}) {
  const camera=useRef(null),file=useRef(null),active=useRef(false),generation=useRef(0)
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  useEffect(()=>()=>{generation.current++;onBusy?.(false)},[onBusy])
  async function choose(event){
    const selected=event.target.files?.[0];event.target.value=''
    if(!selected||active.current||disabled)return
    const version=generation.current;active.current=true;setBusy(true);onBusy?.(true);setError('')
    try{const photo=await receiptImage(selected);if(version===generation.current)onChange(photo)}
    catch(failure){if(version===generation.current)setError(failure.message)}
    finally{active.current=false;if(version===generation.current){setBusy(false);onBusy?.(false)}}
  }
  return <div className="stack gap-12" aria-busy={busy}>
    <span className="field-label">Reference image (optional)</span>
    {value&&<img className="receipt-photo" src={value.image} alt="Reference image draft"/>}
    <input hidden ref={camera} type="file" aria-label="Take reference photo" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={choose}/>
    <input hidden ref={file} type="file" aria-label="Choose reference image" accept="image/jpeg,image/png,image/webp" onChange={choose}/>
    <div className="button-row"><button type="button" className="button ghost" disabled={disabled||busy} onClick={()=>camera.current?.click()}><Camera size={17}/>Take photo</button><button type="button" className="button ghost" disabled={disabled||busy} onClick={()=>file.current?.click()}><ImagePlus size={17}/>Choose photo</button>{value&&<button type="button" className="icon-button" title="Remove selected image" aria-label="Remove selected image" disabled={disabled||busy} onClick={()=>onChange(null)}><X size={17}/></button>}</div>
    {shared&&<small className="muted">Visible to members of this shared wallet.</small>}
    {busy&&<p role="status">Preparing photo...</p>}{error&&<p role="alert" className="form-error">{error}</p>}
  </div>
}
