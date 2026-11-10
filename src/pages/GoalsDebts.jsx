import AppSelect from '../components/AppSelect'
import { useEffect, useRef, useState } from 'react'
import { celebrateMilestone } from '../lib/milestone'
import { ArrowLeft, ChevronRight, HandCoins, Pencil, Plus, Target, Trash2 } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import PageActions from '../components/PageActions'
import { api, jsonBody, money } from '../lib/api'
import { useApp } from '../App'
import Modal from '../components/Modal'
import { DateField } from '../components/DateTimeField'
import ProgressBar from '../components/ProgressBar'
import EmptyState from '../components/EmptyState'
export default function GoalsDebts(){
 const {user, activeSpace} = useApp()
 const [params, setParams] = useSearchParams()
 const goalId = params.get('goal')
 const debtId = params.get('debt')
 const isDetail = params.has('goal') || params.has('debt')
 const showDebts = params.get('tab') === 'debts' || params.has('debt')
 const [history, setHistory] = useState(null)
 const [loaded, setLoaded] = useState(false)
 const recording = useRef(false)
 const {settings,refreshKey,refresh,notify,confirm,canManage=true}=useApp(); const [goals,setGoals]=useState([]); const [debts,setDebts]=useState([]); const [mode,setMode]=useState(null); const [action,setAction]=useState(null); const [form,setForm]=useState({}); const [amount,setAmount]=useState(''); const [error,setError]=useState(''); const load=(signal)=>Promise.all([api('/api/goals',{signal}),api('/api/debts',{signal})]).then(([g,d])=>{if(!signal?.aborted){setGoals(g);setDebts(d);setLoaded(true)}}); useEffect(()=>{const controller=new window.AbortController();setError('');load(controller.signal).catch(err=>{if(!controller.signal.aborted)setError(err.message)});return()=>controller.abort()},[refreshKey]); const fmt=v=>money(v,settings.currency,settings.compact_numbers)
 useEffect(() => {
   if (!goalId || !goals.some(goal => String(goal.id) === goalId)) return
   const controller = new AbortController()
   setHistory(null)
   api(`/api/goals/${goalId}/contributions`, {signal:controller.signal})
     .then(rows => { if (!controller.signal.aborted) setHistory({goalId,rows}) })
     .catch(error => { if (!controller.signal.aborted) setHistory({goalId,error:error.message}) })
   return () => controller.abort()
 }, [goalId, goals])
 const openGoal=g=>{setForm(g?{...g,target_amount:g.target_amount,current_amount:g.current_amount,deadline:g.deadline||''}:{name:'',target_amount:'',current_amount:0,deadline:'',icon:'target',color:'#0a4173'});setAction(null);setMode('goal')}; const openDebt=d=>{setForm(d?{...d,principal:d.principal,remaining:d.remaining,due_date:d.due_date||''}:{name:'',kind:'owed',principal:'',remaining:'',interest_rate:0,due_date:'',minimum_payment:0,notes:''});setAction(null);setMode('debt')}
 const submit=async e=>{e.preventDefault();try{const goal=mode==='goal';const payload=goal?{...form,target_amount:Number(form.target_amount),current_amount:Number(form.current_amount||0),deadline:form.deadline||null}:{...form,principal:Number(form.principal),remaining:Number(form.remaining === '' || form.remaining == null ? form.principal : form.remaining),interest_rate:Number(form.interest_rate||0),minimum_payment:Number(form.minimum_payment||0),due_date:form.due_date||null};await api(mode==='goal'&&form.id?`/api/goals/${form.id}`:mode==='debt'&&form.id?`/api/debts/${form.id}`:goal?'/api/goals':'/api/debts',{method:form.id?'PUT':'POST',...jsonBody(payload)});setMode(null);refresh();notify(form.id?(goal?'Goal updated':'Debt updated'):(goal?'Goal created':'Debt added'))}catch(err){notify(err.message,'error')}}
 const contribute=async()=>{
   if (!(Number(amount)>0) || recording.current) return
   recording.current = true
   try {
     const isGoal = action.type === 'goal'
     const previous = (isGoal ? goals : debts).find(item => item.id === action.id)
     const result = await api(isGoal ? `/api/goals/${action.id}/contribute` : `/api/debts/${action.id}/pay`,{method:'POST',...jsonBody({amount:Number(amount)})})
     const completed = previous && (isGoal ? previous.current_amount < previous.target_amount && result.current_amount >= previous.target_amount : previous.remaining > 0 && result.remaining === 0)
     if (completed) celebrateMilestone(`${user?.id}:${action.type}:${action.id}`,isGoal ? 'Goal reached' : 'Debt cleared',action.name,user?.id)
     else if (isGoal && previous?.target_amount > 0) {
       const before = previous.current_amount / previous.target_amount * 100
       const after = result.current_amount / previous.target_amount * 100
       const milestone = [75,50,25].find(value => before < value && after >= value)
       if (milestone) celebrateMilestone(`${user?.id}:goal:${action.id}:${milestone}`,`${milestone}% of your goal`,action.name,user?.id)
     }
     setAction(null);setAmount('');refresh();notify(isGoal?'Goal contribution recorded':'Debt payment recorded')
   } catch(err) { notify(err.message,'error') }
   finally { recording.current = false }
 }
 const remove=async(type,id)=>{if(!await confirm(`Delete this ${type}?`))return;try{await api(`/api/${type==='goal'?'goals':'debts'}/${id}`,{method:'DELETE'});setParams(type === 'debt' ? {tab:'debts'} : {}, {replace:true});refresh();notify(`${type==='goal'?'Goal':'Debt'} deleted`)}catch(err){notify(err.message,'error')}}
 const goal = goals.find(item => String(item.id) === goalId)
 const debt = debts.find(item => String(item.id) === debtId)
 const item = goal || debt
 const listLink = showDebts ? '/goals?tab=debts' : '/goals'
 const scope = activeSpace?.name || 'Personal'
 const detailHistory = history?.goalId === goalId ? history : null
 const startContribution = (type, record) => {
   setAmount('')
   setAction({type,id:record.id,name:record.name})
 }
 return <div className="poc-goals">
   {error && <div className="form-error" role="alert">{error}<button type="button" className="button ghost small" onClick={refresh}>Retry</button></div>}
   {isDetail ? <>
     <section className="palette-dark-section goal-detail-hero">
       <Link className="wallet-page-back" to={listLink}><ArrowLeft size={17} aria-hidden="true"/> Goals &amp; debts</Link>
       {item ? <>
         <span className="goal-detail-icon">{goal ? <Target size={29} aria-hidden="true"/> : <HandCoins size={29} aria-hidden="true"/>}</span>
         <h2>{item.name}</h2><p>{scope}</p>
         <strong className="goal-detail-amount">{fmt(goal ? item.current_amount : item.remaining)}</strong>
         <p>{goal ? `of ${fmt(item.target_amount)} target` : 'remaining'}</p>
         <ProgressBar value={item.progress} label={goal ? 'Goal saved' : 'Debt cleared'}/>
         <p>{item.progress}% {goal ? 'saved' : 'cleared'}</p>
         {canManage && (goal || item.kind === 'owed') && <button type="button" className="button primary palette-header-action" onClick={() => startContribution(goal ? 'goal' : 'debt', item)}><Plus size={17}/>{goal ? 'Add contribution' : 'Record payment'}</button>}
       </> : <p role="status">{loaded ? 'This item is unavailable in this workspace.' : 'Loading details…'}</p>}
     </section>
     {item && <section className="palette-sheet goal-detail-sheet stack gap-12">
       <div className="poc-section-heading"><h3>{goal ? 'Contribution history' : 'Debt details'}</h3></div>
       {goal ? <>
         {detailHistory?.error ? <div className="form-error" role="alert">{detailHistory.error}<button type="button" className="button ghost small" onClick={refresh}>Retry</button></div>
           : !detailHistory ? <p role="status">Loading contribution history…</p>
           : detailHistory.rows.length ? detailHistory.rows.map((entry,index) => <div className="poc-metric-line" key={`${entry.recorded_at}:${index}`}><span>{new Date(entry.recorded_at).toLocaleDateString(undefined,{dateStyle:'medium',timeZone:'Asia/Kuwait'})}</span><strong className="tx-amount income">+{fmt(entry.amount)}</strong></div>)
           : <p className="muted">No contributions recorded in history yet.</p>}
         <p className="muted">The saved total includes earlier amounts. History starts with contributions recorded using this version.</p>
         {item.deadline && <div className="poc-metric-line"><span>Target date</span><strong>{item.deadline}</strong></div>}
       </> : <dl className="transaction-details"><div><dt>Type</dt><dd>{item.kind === 'owed' ? 'You owe' : 'Owed to you'}</dd></div><div><dt>Original amount</dt><dd>{fmt(item.principal)}</dd></div><div><dt>Minimum payment</dt><dd>{fmt(item.minimum_payment)}</dd></div><div><dt>Interest</dt><dd>{item.interest_rate}%</dd></div><div><dt>Due date</dt><dd>{item.due_date || 'No due date'}</dd></div></dl>}
       {item.notes && <p className="transaction-note">{item.notes}</p>}
       <details className="poc-disclosure"><summary>About this {goal ? 'goal' : 'debt'}</summary>
         <p className="muted">Contributions and payments update progress only. Record actual money movements in Transactions.</p>
         {canManage && <div className="button-row"><button type="button" className="button ghost" onClick={() => goal ? openGoal(item) : openDebt(item)}><Pencil size={16}/>Edit {item.name}</button><button type="button" className="button danger" onClick={() => remove(goal ? 'goal' : 'debt',item.id)}><Trash2 size={16}/>Delete {item.name}</button></div>}
       </details>
     </section>}
   </> : <>
     {canManage && <PageActions><button type="button" className="button primary palette-header-action" data-tour="goal-actions" onClick={() => showDebts ? openDebt() : openGoal()}><Plus size={17}/>{showDebts ? 'Add debt' : 'New goal'}</button></PageActions>}
     <div className="poc-pills" role="group" aria-label="Goals and debts"><button type="button" aria-pressed={!showDebts} onClick={() => setParams({}, {replace:true})}>Savings goals</button><button type="button" aria-pressed={showDebts} onClick={() => setParams({tab:'debts'}, {replace:true})}>Debts</button></div>
     <div className="poc-list">
       {(showDebts ? debts : goals).map(record => <Link key={record.id} className="poc-line" to={`/goals?${showDebts ? 'debt' : 'goal'}=${record.id}`}>
         <span className="poc-marker">{showDebts ? <HandCoins size={18} aria-hidden="true"/> : <Target size={18} aria-hidden="true"/>}</span>
         <span><strong>{record.name}</strong><small>{showDebts ? `${fmt(record.remaining)} remaining` : `${fmt(record.current_amount)} of ${fmt(record.target_amount)}`}</small></span>
         <ChevronRight size={16} aria-hidden="true"/>
       </Link>)}
       {!loaded && !error && <p role="status">Loading goals and debts…</p>}
       {loaded && !(showDebts ? debts : goals).length && <EmptyState title={showDebts ? 'No debts tracked' : 'No goals yet'} text={showDebts ? 'Add an installment, loan, or money owed to you.' : 'Set a savings target to track your progress.'}/>}
     </div>
   </>}
 <Modal open={!!mode} onClose={()=>setMode(null)} title={`${form.id?'Edit':'Create'} ${mode==='goal'?'savings goal':'debt'}`}><form onSubmit={submit} className="stack gap-16"><label className="field"><span>Name</span><input required value={form.name||''} onChange={e=>setForm({...form,name:e.target.value})}/></label>{mode==='goal'?<div className="form-grid two"><label className="field"><span>Target amount</span><input required type="number" min="0.001" step="0.001" value={form.target_amount||''} onChange={e=>setForm({...form,target_amount:e.target.value})}/></label><label className="field"><span>Already saved</span><input type="number" min="0" step="0.001" value={form.current_amount||0} onChange={e=>setForm({...form,current_amount:e.target.value})}/></label><DateField label="Deadline" value={form.deadline||''} allowClear onChange={value=>setForm({...form,deadline:value})}/></div>:<div className="form-grid two"><label className="field"><span>Type</span><AppSelect value={form.kind||'owed'} onChange={e=>setForm({...form,kind:e.target.value})}><option value="owed">I owe this</option><option value="receivable">Owed to me</option></AppSelect></label><label className="field"><span>Original amount</span><input required type="number" min="0.001" step="0.001" value={form.principal||''} onChange={e=>setForm({...form,principal:e.target.value,remaining:form.remaining === '' || form.remaining == null ? e.target.value : form.remaining})}/></label><label className="field"><span>Remaining</span><input required type="number" min="0" step="0.001" value={form.remaining ?? ''} onChange={e=>setForm({...form,remaining:e.target.value})}/></label><label className="field"><span>Interest %</span><input type="number" min="0" step="0.01" value={form.interest_rate||0} onChange={e=>setForm({...form,interest_rate:e.target.value})}/></label><DateField label="Due date" value={form.due_date||''} allowClear onChange={value=>setForm({...form,due_date:value})}/><label className="field"><span>Minimum payment</span><input type="number" min="0" step="0.001" value={form.minimum_payment||0} onChange={e=>setForm({...form,minimum_payment:e.target.value})}/></label></div>}<div className="modal-actions"><button type="button" className="button ghost" onClick={()=>setMode(null)}>Cancel</button><button className="button primary">Save</button></div></form></Modal>
 <Modal open={!!action} onClose={()=>setAction(null)} title={action?.type==='goal'?'Add contribution':'Record debt payment'} subtitle={action?.name}><div className="stack gap-16"><label className="amount-input"><span>Amount</span><input autoFocus type="number" min="0.001" step="0.001" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="0.000"/></label><div className="modal-actions"><button className="button ghost" disabled={!canManage} onClick={()=>setAction(null)}>Cancel</button><button className="button primary" disabled={!amount} onClick={contribute}>Record</button></div></div></Modal></div>
}
