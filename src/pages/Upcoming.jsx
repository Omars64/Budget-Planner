import { useEffect, useMemo, useState } from 'react'
import { Bell, CalendarClock, Check, Pencil, Plus, Trash2, X } from 'lucide-react'
import { api, jsonBody, money } from '../lib/api'
import { dateInput, saveDate, showTime } from '../lib/time'
import { useApp } from '../App'
import '../upcoming.css'

const empty = () => ({type:'expense', amount:'', description:'', notes:'', date:dateInput(new Date(Date.now()+86400000)), wallet_id:'', transfer_wallet_id:'', category_id:'', status:'planned', reminder_enabled:true})

export default function Upcoming() {
  const { user, settings, notify, confirm } = useApp()
  const [rows, setRows] = useState([])
  const [wallets, setWallets] = useState([])
  const [categories, setCategories] = useState([])
  const [scope, setScope] = useState('all')
  const [filter, setFilter] = useState('upcoming')
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = async () => {
    const [plans, owned, shared, ownCategories] = await Promise.all([
      api('/api/planned-transactions'), api('/api/wallets'), api('/api/shared/wallets'), api('/api/categories')
    ])
    setRows(plans)
    const own = owned.filter(w => !w.archived && !w.is_shared).map(w => ({id:w.id,name:w.name,owner_id:user.id,shared:false,editable:true}))
    const others = shared.filter(w => !w.archived).map(w => ({id:w.wallet_id,name:w.name,owner_id:w.owner_id,shared:true,editable:w.can_add}))
    setWallets([...own,...others.filter(w => !own.some(item => item.id === w.id))])
    setCategories(ownCategories)
    setLoading(false)
  }
  useEffect(() => { let active=true; load().catch(err=>{if(active){setError(err.message);setLoading(false)}}); return ()=>{active=false} }, [user.id])

  const start = row => {
    setError('')
    if (row) setDraft({...row, status:row.status==='failed'?'planned':row.status, amount:String(row.amount), date:dateInput(row.date), wallet_id:String(row.wallet_id), transfer_wallet_id:row.transfer_wallet_id ? String(row.transfer_wallet_id) : '', category_id:row.category_id ? String(row.category_id) : ''})
    else setDraft({...empty(),wallet_id:String(wallets.find(w=>w.editable)?.id || '')})
  }
  const change = (key,value) => setDraft(current => ({...current,[key]:value,...(key==='wallet_id'?{category_id:'',transfer_wallet_id:''}:{}),...(key==='type'?{category_id:'',transfer_wallet_id:''}:{})}))
  const wallet = wallets.find(w=>String(w.id)===String(draft?.wallet_id))
  const availableCategories = categories.filter(c=>c.kind===draft?.type && wallet?.owner_id===user.id)
  useEffect(() => {
    if (!draft?.wallet_id || wallet?.owner_id===user.id) return
    let active=true
    api(`/api/shared/wallets/${draft.wallet_id}/categories`).then(items=>{if(active)setCategories(current=>[...current.filter(c=>c.wallet_id!==Number(draft.wallet_id)),...items.map(c=>({...c,wallet_id:Number(draft.wallet_id)}))])}).catch(()=>{})
    return ()=>{active=false}
  }, [draft?.wallet_id, wallet?.owner_id, user.id])
  const choices = wallet?.owner_id===user.id ? availableCategories : categories.filter(c=>c.kind===draft?.type && c.wallet_id===Number(draft?.wallet_id))
  const displayed = useMemo(()=>rows.filter(row => (scope==='all'||(scope==='shared')===row.shared) && (filter==='all'||(filter==='upcoming'?['planned','scheduled','failed'].includes(row.status):row.status===filter))),[rows,scope,filter])
  const total = displayed.filter(row=>row.status!=='posted').reduce((value,row)=>value+(row.type==='income'?row.amount:row.type==='expense'?-row.amount:0),0)
  const categoryLabel = row => row.type === 'transfer' ? wallets.find(item => item.id === row.transfer_wallet_id)?.name || 'Destination wallet' : row.category_name || 'Uncategorized'

  const save = async event => {
    event.preventDefault()
    if (!draft || busy) return
    if (!draft.description.trim() || !Number.isFinite(Number(draft.amount)) || Number(draft.amount)<=0 || !draft.wallet_id || !draft.date) {setError('Enter a description, positive amount, wallet, and date.');return}
    if (draft.status==='scheduled' && new Date(saveDate(draft.date)).getTime()<=Date.now()) {setError('Choose a future date and time for automatic recording.');return}
    setBusy(true);setError('')
    try {
      await api(draft.id?`/api/planned-transactions/${draft.id}`:'/api/planned-transactions',{method:draft.id?'PUT':'POST',...jsonBody({status:draft.status==='failed'?'planned':draft.status,reminder_enabled:draft.reminder_enabled,transaction:{type:draft.type,amount:Number(draft.amount),description:draft.description.trim(),notes:draft.notes||'',date:saveDate(draft.date),wallet_id:Number(draft.wallet_id),transfer_wallet_id:draft.type==='transfer'?Number(draft.transfer_wallet_id):null,category_id:draft.type==='transfer'||!draft.category_id?null:Number(draft.category_id),recurring_frequency:'none',recurring_until:null}})})
      setDraft(null);await load();notify('Upcoming entry saved')
    } catch(err){setError(err.message)} finally {setBusy(false)}
  }
  const remove = async row => {if(!await confirm(`Delete "${row.description}" from upcoming entries?`))return;try{await api(`/api/planned-transactions/${row.id}`,{method:'DELETE'});await load();notify('Upcoming entry deleted')}catch(err){notify(err.message,'error')}}
  return <section className="upcoming-page">
    <header className="upcoming-toolbar"><div><h3>Upcoming records</h3><p className="muted">Plan income and expenses without changing wallet balances.</p></div><button className="button primary" data-tour="new-plan" onClick={()=>start(null)}><Plus size={17}/>New row</button></header>
    <div className="upcoming-controls"><div className="segment-control" aria-label="Wallet context">{[['all','All'],['personal','Personal'],['shared','Shared']].map(([value,label])=><button key={value} className={scope===value?'active':''} onClick={()=>setScope(value)}>{label}</button>)}</div><select aria-label="Plan status" value={filter} onChange={event=>setFilter(event.target.value)}><option value="upcoming">Upcoming</option><option value="all">All records</option><option value="planned">Planned</option><option value="scheduled">Scheduled</option><option value="failed">Needs attention</option><option value="posted">Recorded</option></select><span className="upcoming-total">Net planned: {money(total,settings.currency)}</span></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {draft && <form className="upcoming-mobile-editor stack gap-12" onSubmit={save}><div className="form-grid two"><label className="field"><span>Due date & time</span><input type="datetime-local" value={draft.date} onChange={event=>change('date',event.target.value)}/></label><label className="field"><span>Type</span><select value={draft.type} onChange={event=>change('type',event.target.value)}><option value="expense">Expense</option><option value="income">Income</option><option value="transfer">Transfer</option></select></label></div><label className="field"><span>Description</span><input maxLength="160" value={draft.description} onChange={event=>change('description',event.target.value)}/></label><div className="form-grid two"><label className="field"><span>Wallet</span><select value={draft.wallet_id} onChange={event=>change('wallet_id',event.target.value)}><option value="">Choose wallet</option>{wallets.filter(w=>w.editable).map(w=><option key={w.id} value={w.id}>{w.name}{w.shared?' · Shared':''}</option>)}</select></label><label className="field"><span>{draft.type==='transfer'?'Destination':'Category'}</span>{draft.type==='transfer'?<select value={draft.transfer_wallet_id} onChange={event=>change('transfer_wallet_id',event.target.value)}><option value="">Choose destination</option>{wallets.filter(w=>w.editable&&w.owner_id===wallet?.owner_id&&String(w.id)!==String(wallet?.id)).map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select>:<select value={draft.category_id} onChange={event=>change('category_id',event.target.value)}><option value="">Uncategorized</option>{choices.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>}</label></div><div className="form-grid two"><label className="field"><span>Amount ({settings.currency})</span><input type="number" min="0.001" step="0.001" value={draft.amount} onChange={event=>change('amount',event.target.value)}/></label><label className="field"><span>Recording</span><select value={draft.status} onChange={event=>change('status',event.target.value)}><option value="planned">Plan only</option><option value="scheduled">Auto record</option></select></label></div><label className="check-row"><input type="checkbox" checked={draft.reminder_enabled} onChange={event=>change('reminder_enabled',event.target.checked)}/>Remind me</label><div className="modal-actions"><button type="button" className="button ghost" onClick={()=>{setDraft(null);setError('')}}>Cancel</button><button className="button primary" disabled={busy}>Save entry</button></div></form>}
    <div className="upcoming-mobile-list">
      {loading ? <p className="upcoming-empty">Loading upcoming records...</p> : displayed.length === 0 ? <p className="upcoming-empty">No entries in this view.</p> : displayed.map(row => <article className="upcoming-mobile-row" key={row.id}>
        <div className="upcoming-mobile-top"><span>{showTime(row.date)}</span><span className={`upcoming-status ${row.status}`}>{row.status === 'posted' ? 'Recorded' : row.status === 'failed' ? 'Needs attention' : row.status}</span></div>
        <div className="upcoming-mobile-main"><div><strong>{row.description}</strong><small>{row.wallet_name}{row.shared ? ` · Shared with ${row.owner_name}` : ''}</small><small>{categoryLabel(row)}</small></div><b className={`upcoming-type ${row.type}`}>{row.type === 'expense' ? '-' : row.type === 'income' ? '+' : ''}{money(row.amount, settings.currency)}</b></div>
        {row.error && <p className="upcoming-error" role="status">{row.error}</p>}
        {(row.reminder_enabled && row.status !== 'posted' || row.can_edit && row.status !== 'posted') && <div className="upcoming-mobile-actions">{row.reminder_enabled && row.status !== 'posted' && <span><Bell size={15}/> Reminder on</span>}{row.can_edit && row.status !== 'posted' && <div className="button-row"><button type="button" className="icon-button" title="Edit entry" aria-label={`Edit ${row.description}`} onClick={() => start(row)}><Pencil size={17}/></button><button type="button" className="icon-button" title="Delete entry" aria-label={`Delete ${row.description}`} onClick={() => remove(row)}><Trash2 size={17}/></button></div>}</div>}
      </article>)}
    </div>
    <div className="upcoming-grid-wrap"><table className="upcoming-grid"><thead><tr><th>Due date & time</th><th>Type</th><th>Description</th><th>Wallet</th><th>Category / destination</th><th>Amount</th><th>Recording</th><th>Reminder</th><th aria-label="Actions"/></tr></thead><tbody>
      {draft && <tr className="editing"><td><input aria-label="Due date and time" type="datetime-local" required value={draft.date} onChange={event=>change('date',event.target.value)}/></td><td><select aria-label="Entry type" value={draft.type} onChange={event=>change('type',event.target.value)}><option value="expense">Expense</option><option value="income">Income</option><option value="transfer">Transfer</option></select></td><td><input aria-label="Description" required maxLength="160" placeholder="What is this for?" value={draft.description} onChange={event=>change('description',event.target.value)}/></td><td><select aria-label="Wallet" value={draft.wallet_id} onChange={event=>change('wallet_id',event.target.value)}><option value="">Choose wallet</option>{wallets.filter(w=>w.editable).map(w=><option key={w.id} value={w.id}>{w.name}{w.shared?' · Shared':''}</option>)}</select></td><td>{draft.type==='transfer'?<select aria-label="Destination wallet" value={draft.transfer_wallet_id} onChange={event=>change('transfer_wallet_id',event.target.value)}><option value="">Choose destination</option>{wallets.filter(w=>w.editable&&w.owner_id===wallet?.owner_id&&String(w.id)!==String(wallet?.id)).map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select>:<select aria-label="Category" value={draft.category_id} onChange={event=>change('category_id',event.target.value)}><option value="">Uncategorized</option>{choices.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>}</td><td><input aria-label="Amount" type="number" step="0.001" min="0.001" required value={draft.amount} onChange={event=>change('amount',event.target.value)}/></td><td><select aria-label="Recording mode" value={draft.status} onChange={event=>change('status',event.target.value)}><option value="planned">Plan only</option><option value="scheduled">Auto record</option></select></td><td><input aria-label="Remind me" type="checkbox" checked={draft.reminder_enabled} onChange={event=>change('reminder_enabled',event.target.checked)}/></td><td><div className="button-row"><button className="icon-button" title="Save entry" aria-label="Save entry" disabled={busy} onClick={save}><Check size={17}/></button><button className="icon-button" title="Cancel editing" aria-label="Cancel editing" onClick={()=>{setDraft(null);setError('')}}><X size={17}/></button></div></td></tr>}
      {loading?<tr><td colSpan="9">Loading upcoming records...</td></tr>:displayed.length===0?<tr><td colSpan="9" className="upcoming-empty">No entries in this view.</td></tr>:displayed.map(row=><tr key={row.id}><td>{showTime(row.date)}</td><td className={`upcoming-type ${row.type}`}>{row.type}</td><td><strong>{row.description}</strong>{row.error&&<small className="upcoming-error">{row.error}</small>}</td><td>{row.wallet_name}{row.shared&&<small>Shared · {row.owner_name}</small>}</td><td>{categoryLabel(row)}</td><td className="upcoming-money">{money(row.amount,settings.currency)}</td><td><span className={`upcoming-status ${row.status}`}>{row.status==='posted'?'Recorded':row.status}</span></td><td>{row.reminder_enabled&&row.status!=='posted'?<Bell size={16}/>:null}</td><td>{row.can_edit&&row.status!=='posted'&&<div className="button-row"><button className="icon-button" title="Edit entry" aria-label={`Edit ${row.description}`} onClick={()=>start(row)}><Pencil size={16}/></button><button className="icon-button" title="Delete entry" aria-label={`Delete ${row.description}`} onClick={()=>remove(row)}><Trash2 size={16}/></button></div>}{row.status==='posted'&&<Check size={16}/>}</td></tr>)}
    </tbody></table></div>
    <p className="muted upcoming-footnote"><CalendarClock size={15}/> Auto record runs on your next app visit after the due time, or during daily maintenance. Planned rows remain estimates until recorded.</p>
  </section>
}
