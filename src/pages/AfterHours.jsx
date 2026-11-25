import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../App'
import { api } from '../lib/api'
import frameTemplate from './AfterHoursFrame.html?raw'
import { remaining } from '../lib/debtWorkspace'
import { useAppMotion } from '../lib/appMotion'

const destinations = ['/bank-messages','/transactions','/debt-management/reminders']
export default function AfterHours() {
  const { user, bankInboxCount, refreshKey } = useApp()
  const navigate = useNavigate()
  const frame = useRef(null)
  const motion = useAppMotion()
  const [counts,setCounts] = useState([null,null])
  const [retry,setRetry] = useState(0)
  const [failed,setFailed] = useState(false)
  useEffect(()=>{
    const controller=new AbortController(), options={signal:controller.signal}
    Promise.all([api('/api/transactions?scope=personal&category_id=0&tx_type=expense&exclude_opening=true&limit=1',options),api('/api/debt-workspace',options)]).then(([entries,debts])=>{
      if (!controller.signal.aborted) {setCounts([entries.length?'Review uncategorized expenses':0,debts.records.filter(r=>remaining(r)>0).length]);setFailed(false)}
    }).catch(error=>{if(!controller.signal.aborted){if([401,403].includes(error.status))setCounts([null,null]);setFailed(true)}})
    return ()=>controller.abort()
  },[refreshKey,retry])
  useEffect(()=>{
    const background=document.getElementById('root')
    const previous=background?.inert
    if(background)background.inert=true
    const back=event=>{
      if(event.defaultPrevented)return
      event.preventDefault()
      const editor=frame.current?.contentDocument?.querySelector('dialog[open]')
      if(editor)editor.close()
      else navigate('/more')
    }
    window.addEventListener('budgetly:back',back)
    return ()=>{if(background)background.inert=previous;window.removeEventListener('budgetly:back',back)}
  },[navigate])
  const sync=useCallback(()=>frame.current?.contentWindow?.postMessage({kind:'budgetly-station-state',counts:[bankInboxCount,...counts],motion:motion==='full'},location.origin),[bankInboxCount,counts,motion])
  useEffect(()=>{sync()},[sync])
  useEffect(()=>{
    const handle=e=>{
      if(e.source!==frame.current?.contentWindow || e.origin!==location.origin || e.data?.kind!=='budgetly-station')return
      const dest=e.data.destination
      if(dest==='more')navigate('/more')
      else if(Number.isInteger(dest)&&destinations[dest])navigate(destinations[dest],dest===1?{state:{aiFilters:{category:'0',type:'expense'}}}:undefined)
    }
    window.addEventListener('message',handle);return ()=>window.removeEventListener('message',handle)
  },[navigate])
  return createPortal(<section className="after-hours-stage" style={{position:'fixed',inset:0,zIndex:10000,background:'#180f20',display:'flex',flexDirection:'column',paddingTop:'env(safe-area-inset-top)',paddingBottom:'env(safe-area-inset-bottom)'}}>{failed&&<p role="alert">Station activity could not refresh. <button onClick={()=>setRetry(n=>n+1)}>Retry</button></p>}<iframe ref={frame} title="After Hours Miami radio and district customization" onLoad={sync} srcDoc={frameTemplate.replace('ACCOUNT_ID',encodeURIComponent(user.id)).replace('STUDIO_BASE',new URL(import.meta.env.BASE_URL+'after-hours/',document.baseURI).href)} style={{width:'100%',flex:1,minHeight:0,border:0}}/></section>,document.body)
}
