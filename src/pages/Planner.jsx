import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ArrowRight, Bell, Check, Pencil, Plus, RefreshCw, Sparkles, Trash2 } from 'lucide-react'
import { useApp } from '../App'
import { api, jsonBody, money } from '../lib/api'
import { dateInput, saveDate, showTime } from '../lib/time'
import { effectiveMotion } from '../lib/comfort'
import Modal from '../components/Modal'
import DateTimeField, { DateField } from '../components/DateTimeField'
import EmptyState from '../components/EmptyState'
import '../planner.css'

export const editableConfig = config => ({revision:config.revision,goal_reserve:config.goal_reserve,buffer:config.buffer,bills:config.bills.map(({price_history:_history,payments:_payments,...bill}) => bill)})
const shortDate = value => new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(`${value.slice(0,10)}T12:00:00Z`))
const newBill = wallets => ({id:crypto.randomUUID(),name:'',amount:'',wallet_id:wallets[0]?.id || '',due_at:dateInput(),frequency:'monthly',kind:'bill',active:true,reminder_enabled:true,planned_id:null})

function BillEditor({bill,wallets,onClose,onSave,busy,currency}) {
  const [form,setForm] = useState(() => bill.due_at ? {...bill,due_at:dateInput(bill.due_at)} : bill)
  const [links,setLinks] = useState([])
  const [error,setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    api('/api/planner/link-options',{signal:controller.signal}).then(value => { if (!controller.signal.aborted) setLinks(value) }).catch(() => {})
    return () => controller.abort()
  },[])
  const update = patch => setForm(value => ({...value,...patch,...(['wallet_id','amount','due_at'].some(key=>key in patch) ? {planned_id:null} : {})}))
  const submit = async event => {
    event.preventDefault(); setError('')
    try { await onSave({...form,due_at:saveDate(form.due_at),wallet_id:Number(form.wallet_id),amount:String(form.amount)}) }
    catch (err) { setError(err.message) }
  }
  return <Modal open onClose={() => !busy && onClose()} title={bill.name ? 'Edit bill' : 'Add bill'} protectChanges size="medium" footer={<><button type="button" className="button ghost" disabled={busy} onClick={onClose}>Cancel</button><button form="planner-bill" className="button primary" disabled={busy}><Check size={18}/>{busy ? 'Saving...' : 'Save bill'}</button></>}>
    <form id="planner-bill" onSubmit={submit} className="stack gap-16">
      {error && <p className="form-error" role="alert">{error}</p>}
      <label className="field"><span>Name</span><input required maxLength={100} value={form.name} onChange={e=>update({name:e.target.value})}/></label>
      <div className="form-grid two"><label className="field"><span>Amount ({currency})</span><input required inputMode="decimal" type="number" min="0.001" max="999999999" step="0.001" value={form.amount} onChange={e=>update({amount:e.target.value})}/></label><label className="field"><span>Wallet</span><select required value={form.wallet_id} onChange={e=>update({wallet_id:Number(e.target.value)})}><option value="" disabled>Choose wallet</option>{wallets.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label></div>
      <DateTimeField value={form.due_at} onChange={value=>update({due_at:value})}/>
      <div className="form-grid two"><label className="field"><span>Repeat</span><select value={form.frequency} onChange={e=>update({frequency:e.target.value})}><option value="none">Once</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></label><label className="field"><span>Type</span><select value={form.kind} onChange={e=>update({kind:e.target.value})}><option value="bill">Bill</option><option value="subscription">Subscription</option></select></label></div>
      <label className="check-row"><input type="checkbox" checked={form.reminder_enabled} onChange={e=>update({reminder_enabled:e.target.checked})}/><span>Remind me</span></label>
      <small className="muted">Uses Upcoming expense reminders in Settings. Bills remain estimates until you record a payment.</small>
      <details><summary>Already in Upcoming?</summary><label className="field"><span>Link an existing expense</span><select value={form.planned_id || ''} onChange={e=>{ const plan=links.find(p=>p.id===Number(e.target.value)); setForm(value=>({...value,planned_id:plan?.id || null,...(plan ? {wallet_id:plan.wallet_id,amount:plan.amount,due_at:dateInput(plan.date)} : {})})) }}><option value="">No linked entry</option>{links.map(p=><option key={p.id} value={p.id}>{p.description} · {shortDate(p.date)} · {money(p.amount,currency)}</option>)}</select></label><small className="muted">A linked entry counts once. Choose either a recurring ledger entry or a bill for the same payment, not both.</small></details>
      <label className="check-row"><input type="checkbox" checked={form.active} onChange={e=>setForm({...form,active:e.target.checked})}/><span>Include in forecast</span></label>
    </form>
  </Modal>
}

function ReserveEditor({config,onSave,busy,fmt,currency}) {
  const [form,setForm] = useState({goal_reserve:config.goal_reserve,buffer:config.buffer})
  const [error,setError] = useState('')
  return <details className="planner-disclosure"><summary>Money set aside · {fmt(Number(config.goal_reserve)+Number(config.buffer))}</summary><form className="stack gap-16" onSubmit={async e=>{e.preventDefault();setError('');try{await onSave({...config,...form})}catch(err){setError(err.message)}}}>
    <div className="form-grid two">{[['goal_reserve','For goals'],['buffer','Safety buffer']].map(([key,label])=><label className="field" key={key}><span>{label} ({currency})</span><input type="number" required min="0" max="999999999" step="0.001" inputMode="decimal" value={form[key]} onChange={e=>setForm({...form,[key]:e.target.value})}/></label>)}</div>
    <small className="muted">Enter money already included in your personal wallets. Goal progress is not deducted automatically.</small>
    {error && <p className="form-error" role="alert">{error}</p>}<button className="button ghost self-start" disabled={busy}><Check size={16}/>Save reserves</button>
  </form></details>
}

function PaymentLink({bill,events,config,onSave,onClose,busy,fmt}) {
  const cycles = events.filter(e=>e.id.startsWith(`bill:${bill.id}:`))
  const [due,setDue] = useState(cycles[0]?.due_at || bill.due_at)
  const [options,setOptions] = useState([])
  const [chosen,setChosen] = useState('')
  const [error,setError] = useState('')
  useEffect(()=>{
    const controller = new AbortController()
    api(`/api/planner/payment-options?wallet_id=${bill.wallet_id}`,{signal:controller.signal}).then(rows=>{if(!controller.signal.aborted)setOptions(rows.filter(row=>Number(row.amount)===Number(bill.amount)))}).catch(err=>{if(!controller.signal.aborted)setError(err.message)})
    return ()=>controller.abort()
  },[bill.wallet_id,bill.amount])
  return <Modal open title="Link a recorded payment" onClose={()=>!busy&&onClose()}><form className="stack gap-16" onSubmit={async e=>{e.preventDefault();setError('');try{await onSave(`/api/planner/bills/${bill.id}/payment`,{revision:config.revision,occurrence:due,transaction_id:Number(chosen)})}catch(err){setError(err.message)}}}>
    <p>{bill.name} · {fmt(bill.amount)}</p><label className="field"><span>Bill due</span><select value={due} onChange={e=>setDue(e.target.value)}>{(cycles.length?cycles:[{due_at:bill.due_at}]).map(cycle=><option key={cycle.due_at} value={cycle.due_at}>{showTime(cycle.due_at)}</option>)}</select></label>
    <label className="field"><span>Recorded expense</span><select required value={chosen} onChange={e=>setChosen(e.target.value)}><option value="">Choose payment</option>{options.map(o=><option key={o.id} value={o.id}>{o.description} · {showTime(o.date)}</option>)}</select></label>
    {!options.length && <p className="muted">Record an expense with this amount and wallet in Transactions first. Recent payments from the last 180 days appear here.</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="modal-actions"><button type="button" className="button ghost" disabled={busy} onClick={onClose}>Cancel</button><button className="button primary" disabled={busy||!chosen}><Check size={18}/>Link payment</button></div>
  </form></Modal>
}

export default function Planner() {
  const {settings,refreshKey,refresh,notify,confirm,canManage=true,activeSpace} = useApp()
  const navigate = useNavigate()
  const [tab,setTab] = useState('forecast')
  const [days,setDays] = useState(30)
  const [assumptions,setAssumptions] = useState(true)
  const [config,setConfig] = useState(null)
  const [data,setData] = useState(null)
  const [scenario,setScenario] = useState(null)
  const [whatIf,setWhatIf] = useState({amount:'',date:dateInput().slice(0,10),description:''})
  const [editor,setEditor] = useState(null)
  const [payment,setPayment] = useState(null)
  const [busy,setBusy] = useState(false)
  const [loading,setLoading] = useState(true)
  const [error,setError] = useState('')
  const [retry,setRetry] = useState(0)
  const request = useRef(0)
  const fmt = value=>money(value,settings.currency,settings.compact_numbers)
  const load = useCallback(async signal=>{
    const run=++request.current
    setLoading(true);setError('');setScenario(null)
    try {
      const [saved,projection] = await Promise.all([api('/api/planner/config',{signal}),api(`/api/planner/forecast?days=${days}&assumptions=${assumptions}`,{signal})])
      if(!signal?.aborted && run===request.current){setConfig(saved);setData(projection)}
    } catch(err) {if(!signal?.aborted && run===request.current)setError(err.message)}
    finally {if(!signal?.aborted && run===request.current)setLoading(false)}
  },[days,assumptions])
  useEffect(()=>{const controller=new AbortController();void load(controller.signal);return()=>{controller.abort();request.current+=1}},[load,refreshKey,retry])
  const save = async (next,path='/api/planner/config')=>{
    setBusy(true)
    try {const saved=await api(path,{method:path.endsWith('/payment')?'POST':'PUT',...jsonBody(path.endsWith('/payment')?next:editableConfig(next))});setConfig(saved);setEditor(null);setPayment(null);notify('Planner saved');refresh()}
    finally{setBusy(false)}
  }
  const remove = async bill=>{
    if(!await confirm(`Remove ${bill.name} from Planner? Recorded payments stay in Transactions.`))return
    try{await save({...config,bills:config.bills.filter(b=>b.id!==bill.id)})}catch(err){setError(err.message)}
  }
  const preview = async event=>{
    event.preventDefault();setBusy(true);setError('')
    const run=++request.current
    try{const value=await api(`/api/planner/preview?days=${days}&assumptions=${assumptions}`,{method:'POST',...jsonBody({...whatIf,description:whatIf.description.trim()||'What-if purchase'})});if(run===request.current)setScenario(value)}
    catch(err){if(run===request.current)setError(err.message)}finally{setBusy(false)}
  }
  const visible = scenario || data
  return <div className="planner-page">
    <div className="planner-toolbar"><nav aria-label="Planner views" className="planner-tabs">{[['forecast','Forecast'],['bills','Bills'],['what-if','What if']].map(([key,label])=><button type="button" key={key} aria-pressed={tab===key} disabled={busy} onClick={()=>{setTab(key);setScenario(null)}}>{label}</button>)}</nav><button className="icon-button" title="Refresh forecast" aria-label="Refresh forecast" disabled={busy||loading} onClick={()=>setRetry(v=>v+1)}><RefreshCw size={18}/></button></div>
    {error && <div className="form-error" role="alert">{error}<button type="button" className="button ghost small" disabled={busy} onClick={()=>setRetry(v=>v+1)}>Reload</button></div>}
    {loading ? <div className="skeleton-page" aria-label="Loading Planner"><div/><div/></div> : config && data && <>
      {tab!=='bills' && <>
        <div className="planner-horizon"><div className="segmented" aria-label="Forecast duration">{[30,60,90].map(value=><button disabled={busy} key={value} aria-pressed={days===value} className={days===value?'active':''} onClick={()=>setDays(value)}>{value} days</button>)}</div><label className="check-row"><input type="checkbox" disabled={busy} checked={assumptions} onChange={e=>setAssumptions(e.target.checked)}/><span>Include estimates</span></label></div>
        {tab==='what-if' && <form className="planner-scenario" onSubmit={preview}><label className="field"><span>Purchase ({settings.currency})</span><input required type="number" min="0.001" max="999999999" step="0.001" inputMode="decimal" value={whatIf.amount} onChange={e=>{setScenario(null);setWhatIf({...whatIf,amount:e.target.value})}}/></label><DateField label="On" value={whatIf.date} min={data.as_of.slice(0,10)} max={data.points.at(-1).date} onChange={date=>{setScenario(null);setWhatIf({...whatIf,date})}}/><button className="button primary" disabled={busy}><Sparkles size={17}/>Try purchase</button>{scenario && <button type="button" className="button ghost" onClick={()=>setScenario(null)}>Reset</button>}<p className="muted">Preview only. No transaction will be created.</p></form>}
        <section className="planner-totals" aria-label="Cash-flow estimates"><div><span>Available to spend · estimate</span><strong className={Number(visible.available_to_spend)<0?'tx-amount expense':''}>{fmt(visible.available_to_spend)}</strong><small>{visible.next_payday ? `Until next income ${shortDate(visible.next_payday)}` : `Next ${days} days; no income entered`}</small></div><div><span>Balance in {days} days</span><strong>{fmt(visible.projected_balance)}</strong>{scenario && <small>Without purchase: {fmt(data.projected_balance)}</small>}</div><div><span>Lowest projected balance</span><strong>{fmt(visible.lowest_balance)}</strong><small>{shortDate(visible.lowest_date)}</small></div></section>
        {visible.shortfall_date && <div className="planner-warning" role="status"><strong>Possible shortfall · {shortDate(visible.shortfall_date)}</strong><span>{fmt(visible.shortfall_amount)} below money set aside. Review bills or try delaying a purchase.</span></div>}
        <section className="planner-chart" aria-label="Projected balance chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={visible.points} margin={{top:16,right:12,bottom:8,left:0}} accessibilityLayer><CartesianGrid vertical={false} stroke="var(--line)"/><XAxis dataKey="date" tickFormatter={shortDate} minTickGap={45} axisLine={false} tickLine={false} tick={{fill:'var(--muted)',fontSize:12}}/><YAxis width={64} tick={{fill:'var(--muted)',fontSize:12}} axisLine={false} tickLine={false}/><Tooltip labelFormatter={shortDate} formatter={value=>[fmt(value),'Projected balance']} contentStyle={{background:'var(--surface)',color:'var(--text)',border:'1px solid var(--line)',borderRadius:8}}/><ReferenceLine y={Number(visible.reserved)} stroke="var(--muted)" strokeDasharray="4 4"/><Area type="linear" dataKey="balance" stroke="var(--accent)" fill="var(--accent)" fillOpacity={.08} strokeWidth={2} isAnimationActive={effectiveMotion()==='full'} animationDuration={280}/></AreaChart></ResponsiveContainer></section>
        <p className="planner-caption">{activeSpace ? 'Space wallets' : 'Personal wallets'} · cash dates · estimates, not guarantees</p>
        {canManage && <ReserveEditor key={config.revision} config={config} onSave={save} busy={busy} fmt={fmt} currency={settings.currency}/>}
        <details className="planner-disclosure"><summary>How this is calculated</summary><dl className="planner-calculation"><div><dt>Current recorded cash</dt><dd>{fmt(visible.opening_balance)}</dd></div><div><dt>Money set aside</dt><dd>- {fmt(visible.reserved)}</dd></div><div><dt>Outgoings before next income / forecast end</dt><dd>- {fmt(visible.bills_before_payday)}</dd></div><div><dt>Available-to-spend estimate</dt><dd>{fmt(visible.available_to_spend)}</dd></div></dl><p className="muted">Future income is never added to spendable cash today. Shared and archived wallets are excluded. Recorded = ledger entries; Expected = scheduled Upcoming entries; Assumed = bills, planned entries, and recurring records. Estimates include only items you have entered, not all possible daily spending.</p>{visible.warnings.map(w=><p className="form-error" key={w}>{w}</p>)}</details>
        <details className="planner-disclosure"><summary>{visible.events.length} projected movements</summary><div className="planner-events">{visible.events.length ? visible.events.map(event=><div key={event.id}><div><Link to={event.source}>{event.name}</Link><small>{shortDate(event.due_at)} · {event.wallet_name} · {event.certainty}{event.overdue?' · Overdue':''}</small></div><strong className={Number(event.amount)>0?'tx-amount income':'tx-amount expense'}>{Number(event.amount)>0?'+':''}{fmt(event.amount)}</strong></div>):<p className="muted">Add expected income in Upcoming and expenses in Bills to build your forecast.</p>}</div></details>
        {!activeSpace && <button className="button ghost planner-explain" onClick={()=>navigate('/ask-ai',{state:{scope:'personal',question:`Explain my ${days}-day cash-flow planner forecast and possible shortfall. ${assumptions ? 'Include estimates.' : 'Exclude assumptions; use only recorded and scheduled items.'} Suggest options for me to review without changing any records.`}})}><Sparkles size={18}/>{scenario ? 'Explain baseline forecast' : 'Explain my forecast'} <ArrowRight size={16}/></button>}
      </>}
      {tab==='bills' && <>
        <div className="panel-head"><h3>Bills & subscriptions</h3><button className="button primary" disabled={!canManage||busy||!data.wallets.length||config.bills.length>=100} onClick={()=>setEditor(newBill(data.wallets))}><Plus size={18}/>Add bill</button></div>
        {!data.wallets.length && <p className="muted">Add an active personal wallet in <Link to="/wallets">Wallets</Link> first.</p>}
        {!config.bills.length && <EmptyState title="No bills yet" text="Add bills or renewals to see what comes next."/>}
        <div className="planner-bills">{config.bills.map(bill=><article key={bill.id} className={`planner-bill${bill.active?'':' paused'}`}><div className="planner-bill-main"><div><h4>{bill.name}</h4><small>{bill.kind==='subscription'?'Subscription':'Bill'} · {bill.frequency==='none'?'Once':bill.frequency} · {data.wallets.find(w=>w.id===bill.wallet_id)?.name || 'Wallet unavailable'}</small><small>{showTime(bill.due_at)}{bill.active?'':' · Paused'}{bill.planned_id?' · Linked to Upcoming':''}</small></div><strong>{fmt(bill.amount)}</strong></div><div className="planner-bill-tools">{bill.reminder_enabled && <span title="Reminder enabled"><Bell size={16}/></span>}<button className="button ghost small" disabled={!canManage||busy} onClick={()=>setPayment(bill)}><Check size={16}/>Link payment</button><button className="icon-button" disabled={!canManage||busy} title="Edit bill" aria-label={`Edit ${bill.name}`} onClick={()=>setEditor(bill)}><Pencil size={17}/></button><button className="icon-button danger" disabled={!canManage||busy} title="Remove bill" aria-label={`Remove ${bill.name}`} onClick={()=>void remove(bill)}><Trash2 size={17}/></button></div>{bill.price_history?.length>0 && <details><summary>Previous prices</summary>{bill.price_history.map((item,index)=><p className="muted" key={index}>{fmt(item.amount)} · changed {shortDate(item.changed_at)}</p>)}</details>}{bill.payments?.length>0 && <small className="muted">{bill.payments.length} recorded {bill.payments.length===1?'payment linked':'payments linked'}</small>}</article>)}</div>
        <p className="muted">Bills never record payments automatically. Record an expense, then link it here. For auto-recording, use <Link to="/upcoming">Upcoming</Link>.</p>
      </>}
    </>}
    {editor && <BillEditor bill={editor} wallets={data.wallets} currency={settings.currency} busy={busy} onClose={()=>setEditor(null)} onSave={bill=>save({...config,bills:config.bills.some(b=>b.id===bill.id)?config.bills.map(b=>b.id===bill.id?bill:b):[...config.bills,bill]})}/>}
    {payment && <PaymentLink bill={payment} events={data.events} config={config} fmt={fmt} busy={busy} onClose={()=>setPayment(null)} onSave={(path,payload)=>save(payload,path)}/>}
  </div>
}
