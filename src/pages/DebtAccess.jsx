import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, Eye, Plus, UserRound, UserRoundPlus } from 'lucide-react'
import { useApp } from '../App'
import AppSelect from '../components/AppSelect'
import InfoButton from '../components/InfoButton'
import Modal from '../components/Modal'
import { api, jsonBody } from '../lib/api'
import { debtApi, debtPath, debtRoles, debtUrl } from '../lib/debtWorkspace'

const blank = {email:'',role:'view'}
const MemberLabel = ({person}) => <><span className="debt-row-icon"><UserRound size={18} aria-hidden="true"/></span>
  <span className="debt-row-label"><strong>{person.name || person.email}</strong><small>{debtRoles[person.role]}</small></span></>

export default function DebtAccess({spaceId,currency,preview}) {
  const { user, notify, confirm, rememberDebtSpace, refreshDebtSpaces } = useApp()
  const path = debtApi(spaceId)
  const navigate = useNavigate()
  const [details,setDetails] = useState(null)
  const [loadError,setLoadError] = useState('')
  const [retry,setRetry] = useState(0)
  const [panel,setPanel] = useState(null)
  const [entry,setEntry] = useState(blank)
  const [name,setName] = useState('')
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState('')
  const pending = useRef(false)
  const owner = details?.role==='owner' && !preview

  useEffect(()=>{
    if (!spaceId) return
    let request
    const refresh = () => {
      if (pending.current) return
      request?.abort()
      const controller = new AbortController()
      request = controller
      api(`${path}/access`,{signal:controller.signal}).then(data=>{
        if (!controller.signal.aborted) {setDetails(data);setLoadError('')}
      }).catch(failure=>{
        if (!controller.signal.aborted) {setDetails(null);setLoadError(failure.message)}
      })
    }
    refresh()
    window.addEventListener('focus',refresh)
    return ()=>{request?.abort();window.removeEventListener('focus',refresh)}
  },[spaceId,path,retry])

  const manage = person => {
    setError('');setEntry(person ? {email:person.email,role:person.role} : blank);setPanel(person?'edit':'invite')
  }
  const close = () => {if (!pending.current) {setPanel(null);setError('')}}
  const create = async () => {
    if (!name.trim()) throw new Error('Enter a space name.')
    const space = await api(`${debtPath}/spaces`,{method:'POST',...jsonBody({name:name.trim(),currency})})
    rememberDebtSpace(space)
    navigate(debtUrl(space.id,'access'))
    notify('Shared debt space created')
  }
  async function run(action,message) {
    if (pending.current || preview) return
    pending.current=true;setBusy(true);setError('')
    try {
      const result = await action()
      if (result) {
        setDetails(result)
        rememberDebtSpace({id:result.id,name:result.name,role:result.role,member_count:result.member_count})
        void refreshDebtSpaces().catch(()=>{})
      }
      setPanel(null)
      if (message) notify(message)
    } catch (failure) {
      setError(failure.message)
      if ([403,404].includes(failure.status)) setRetry(value=>value+1)
    } finally {pending.current=false;setBusy(false)}
  }
  const save = event => {
    event.preventDefault()
    if (panel==='create') {void run(create); return}
    if (owner) void run(()=>api(`${path}/members`,{method:'PUT',...jsonBody({...entry,email:entry.email.trim()})}),panel==='edit'?'Role saved':'Person added')
  }
  const remove = async () => {
    if (!owner || !await confirm(`Remove access for ${entry.email}?`)) return
    void run(()=>api(`${path}/members/${encodeURIComponent(entry.email)}`,{method:'DELETE'}),'Access removed')
  }
  const members = spaceId ? details?.members || [] : [{name:user?.username || 'You',role:'owner'}]
  return <div className="debt-narrow stack gap-16">
    {spaceId&&!details ? loadError
      ? <p className="form-error" role="alert">{loadError} <button className="button ghost" type="button" onClick={()=>setRetry(value=>value+1)}>Retry</button></p>
      : <p role="status">Loading members…</p>
      : <>
        <div className="debt-record-balance"><small>{details?`${details.member_count} ${details.member_count===1?'person':'people'} · ${debtRoles[preview||details.role]}`:'Only you'}</small>
          <strong>{details?.name || 'Debt Management'}</strong></div>
        <div className="debt-heading"><h2>Members</h2><InfoButton label="About workspace roles" onClick={()=>setPanel('help')}/></div>
        <ul className="debt-list">{members.map(person=><li key={person.email || 'owner'}>
          {owner&&person.role!=='owner' ? <button type="button" className="debt-row" onClick={()=>manage(person)}><MemberLabel person={person}/><ChevronRight size={16}/></button>
            : <div className="debt-row"><MemberLabel person={person}/></div>}
        </li>)}</ul>
        {!spaceId ? <div className="stack gap-12"><p className="muted">Create a shared debt space for records you want to track together.</p><div>
          <button className="button primary" type="button" onClick={()=>{setName('');setError('');setPanel('create')}}><Plus size={18}/>Create shared debt space</button>
        </div></div> : owner ? <div className="button-row">
          <button className="button primary" type="button" onClick={()=>manage()}><UserRoundPlus size={18}/>Add a person</button>
          {members.some(person=>person.role!=='owner')&&<button className="button ghost" type="button" onClick={()=>setPanel('preview')}><Eye size={18}/>Preview member view</button>}
        </div> : <p className="muted">Only the owner can manage members.</p>}
      </>}
    <Modal open={panel==='help'} onClose={close} title="Workspace roles" size="small">
      <p>Owners manage access. Managers can add and change debt records. Viewers can read records and payment history.</p>
    </Modal>
    <Modal open={owner&&panel==='preview'} onClose={close} title="Preview member view" size="small">
      <ul className="debt-list">{members.filter(person=>person.role!=='owner').map(person=><li key={person.email}>
        <button type="button" className="debt-row" onClick={()=>{close();navigate(`${debtUrl(spaceId)}?preview=${person.role}`)}}><MemberLabel person={person}/><Eye size={16}/></button>
      </li>)}</ul>
    </Modal>
    <Modal open={panel==='create'||(owner&&['invite','edit'].includes(panel))} onClose={close} size="small" layerClass="debt-entry-layer"
      title={panel==='create'?'Create shared debt space':panel==='edit'?'Change access':'Add a person'}>
      <form className="stack gap-16" onSubmit={save}>
        {panel==='create' ? <label className="field"><span>Space name</span><input maxLength={40} value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Household debts" required/></label>
          : <>
            {panel==='edit'?<strong>{entry.email}</strong>:
              <label className="field"><span>Budgetly account email</span><input type="email" maxLength={160} value={entry.email} onChange={e=>setEntry({...entry,email:e.target.value})} required/></label>}
            <label className="field"><span>Role</span><AppSelect value={entry.role} onChange={e=>setEntry({...entry,role:e.target.value})}>
              <option value="view">Viewer · read only</option><option value="edit">Manager · manage records</option>
            </AppSelect></label>
            <small className="muted">This gives access to every debt record in {details?.name}.</small>
            {panel==='edit'&&<div><button type="button" className="button ghost" disabled={busy} onClick={()=>void remove()}>Remove access</button></div>}
          </>}
        {error&&<p role="alert" className="form-error">{error}</p>}
        <div className="modal-actions"><button type="button" className="button ghost" onClick={close} disabled={busy}>Cancel</button>
          <button type="submit" className="button primary" disabled={busy}>{busy?'Saving…':panel==='create'?'Create space':panel==='edit'?'Save role':'Add to space'}</button></div>
      </form>
    </Modal>
  </div>
}
