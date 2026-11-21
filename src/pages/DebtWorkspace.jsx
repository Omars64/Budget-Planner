import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ArrowDownLeft, ArrowUpRight, Bell, Calculator, CalendarDays, Check, ChevronRight, History, Landmark, Plus, Receipt, Users } from 'lucide-react'
import { useApp } from '../App'
import { api, jsonBody, money } from '../lib/api'
import { dateKey } from '../lib/time'
import { allItems, dayLabel, debtAmount, debtApi, debtChanged, debtKinds, debtRoute, debtUrl, incoming, left, monthLabel,
  openItems, paid, paymentStatus, payoffMonth, remaining, shiftDay, sum } from '../lib/debtWorkspace'
import { allowDebtAlerts } from '../lib/debtNotifications'
import AppMonthField from '../components/AppMonthField'
import AppSelect from '../components/AppSelect'
import { DateField } from '../components/DateTimeField'
import DebtEntryForm, { DebtReminderField } from '../components/DebtEntryForm'
import EmptyState from '../components/EmptyState'
import InfoButton from '../components/InfoButton'
import Modal from '../components/Modal'
import PageActions from '../components/PageActions'
import DebtSpaces from './DebtSpaces'
import './DebtWorkspace.css'

const explanations = {
  debts:['About Debt Management','Track what you owe and what is owed to you here. Loans include the interest in your schedule. Logging a payment updates this workspace. You can link a matching Personal transaction in More options.'],
  schedule:['About your schedule','The payment month identifies which instalment this covers. The due date can fall in a different month. Open an instalment to see its payments or change its due date.'],
  history:['About payment history','Actual date shows when the money moved. Payment month shows the instalment that the payment covers.'],
  reminders:['About debt reminders','These reminders use your debt due dates and are only for you. Paid instalments clear from the list. Device alerts on Android can arrive when Budgetly is closed. Browser and Windows alerts require Budgetly to be open.'],
  payoff:['About the estimate','This uses the remaining payments in your schedule, including scheduled interest. Extra payments start this month. Money owed to you is excluded.'],
}
const menu = [
  ['schedule','Schedule','See what is due',CalendarDays],
  ['history','History','See payments you recorded',History],
  ['reminders','Debt reminders','Choose when to get alerts',Bell],
  ['payoff','Debt-free calculator','Try a monthly extra payment',Calculator],
  ['directory','Debt spaces','Manage shared debt workspaces',Users],
]
const Row = ({icon:Icon,name,description,amount,status,onClick}) => <li><button type="button" className="debt-row" onClick={onClick}>
  <span className="debt-row-icon"><Icon size={18}/></span><span className="debt-row-label"><strong>{name}</strong><small>{description}</small></span>
  <span className="debt-row-tail">{amount && <strong>{amount}</strong>}{status ? <small>{status}</small> : !amount && <ChevronRight size={16}/>}</span>
</button></li>

export default function DebtWorkspace() {
  const { pathname, search, state } = useLocation()
  const route = debtRoute(pathname)
  if (!route) return <Navigate to={debtUrl()} replace/>
  if (state?.debtReminders && route.view==='debts') return <Navigate to={debtUrl(route.id,'reminders')} replace/>
  const requestedPreview = new URLSearchParams(search).get('preview')
  if (route.view==='directory') return <DebtSpaces key={route.id || 'private'} spaceId={route.id} requestedPreview={requestedPreview}/>
  return <DebtScreen key={route.id || 'private'} spaceId={route.id} tab={route.view} requestedPreview={requestedPreview}/>
}

function DebtScreen({spaceId,tab,requestedPreview}) {
  const { accountSettings, settings, notify, confirm, refreshKey, debtSpaces = [] } = useApp()
  const location = useLocation()
  const navigate = useNavigate()
  const scope = debtSpaces.find(space=>space.id===spaceId)
  const preview = scope?.role === 'owner' && ['view','edit'].includes(requestedPreview) ? requestedPreview : null
  const canEdit = !spaceId || ['owner','edit'].includes(preview || scope?.role)
  const path = debtApi(spaceId)
  const url = view => debtUrl(spaceId,view)+(preview?`?preview=${preview}`:'')
  const personalCurrency = accountSettings?.currency || settings.currency || 'KWD'
  const today = dateKey(), currentMonth = today.slice(0,7)
  const [workspace,setWorkspace] = useState(null)
  const [loadError,setLoadError] = useState('')
  const [retry,setRetry] = useState(0)
  const [busy,setBusy] = useState(false)
  const saving = useRef(false)
  const request = useRef(null)
  const [direction,setDirection] = useState('owe')
  const [scheduleMonth,setScheduleMonth] = useState(currentMonth)
  const [historyMonth,setHistoryMonth] = useState(currentMonth)
  const [by,setBy] = useState('actual')
  const [modal,setModal] = useState(null)
  const [alerts,setAlerts] = useState(null)
  const [info,setInfo] = useState('')
  const [extra,setExtra] = useState('')
  const [formError,setFormError] = useState('')
  const [edit,setEdit] = useState('')
  const [expanded,setExpanded] = useState(false)
  useEffect(()=>{
    setModal(null);setInfo('');setFormError('')
  },[location.key])
  useEffect(()=>{
    const load = () => {
      if (saving.current) return
      request.current?.abort()
      const controller = new AbortController()
      request.current=controller
      setLoadError('')
      const options = {signal:controller.signal}
      const prefs = spaceId && tab==='reminders' ? api(`${path}/alerts`,options) : Promise.resolve(null)
      Promise.all([api(path,options),prefs]).then(([data,alertPreferences])=>{
        if (!controller.signal.aborted) {setWorkspace(data);if (alertPreferences) setAlerts(alertPreferences)}
      }).catch(failure=>{
        if (controller.signal.aborted) return
        if ([403,404].includes(failure.status)) {setWorkspace(null);setAlerts(null);setModal(null)}
        setLoadError(failure.message)
      })
    }
    load()
    window.addEventListener('focus',load)
    return ()=>{request.current?.abort();window.removeEventListener('focus',load)}
  },[path,retry,refreshKey,spaceId,tab])

  const records = workspace?.records || []
  const currency = workspace?.currency || personalCurrency
  const fmt = amount => money(amount/1000,currency)
  const range = allItems(records)
  const open = openItems(records)
  const activeRecords = records.filter(record=>incoming(record)===(direction==='lent'))
  const next = open.find(({record})=>incoming(record)===(direction==='lent'))
  const enabled = spaceId ? Boolean(alerts?.enabled) : Boolean(workspace?.enabled)
  const reminderLead = record => spaceId ? alerts?.rules?.[record.id] ?? null : record.reminder
  const reminders = enabled ? open.filter(({record})=>reminderLead(record) !== null)
    .map(entry=>({...entry,alert:shiftDay(entry.item.due,-reminderLead(entry.record))}))
    .sort((a,b)=>a.alert.localeCompare(b.alert)) : []
  const selected = records.find(record=>record.id===modal?.record)
  const item = selected?.items.find(entry=>entry.id===modal?.item)
  const close = () => {if (!saving.current){setModal(null);setFormError('')}}
  const show = (type,record,target) => {
    setEdit(type==='due'?target.due:'')
    setFormError('');setExpanded(false)
    setModal({type,revision:workspace?.revision,record:record?.id,item:target?.id})
  }

  async function submit(save,message) {
    if (saving.current || !workspace) throw new Error('Finish the current save first.')
    if (preview) throw new Error('Exit the role preview to save changes.')
    saving.current=true;setBusy(true)
    try {
      request.current?.abort()
      await save()
      window.dispatchEvent(new Event(debtChanged))
      if (message) {setModal(null);notify(message)}
    } catch (failure) {
      if ([403,404,409].includes(failure.status)) setRetry(value=>value+1)
      throw failure
    } finally {saving.current=false;setBusy(false)}
  }
  const update = (transform,message) => submit(async ()=>{
    if (!canEdit) throw new Error('You have view-only access.')
    const draft=window.structuredClone(workspace)
    transform(draft)
    setWorkspace(await api(path,{method:'PUT',...jsonBody(draft)}))
  },message)
  const apply = async (transform,message) => {
    setFormError('')
    try {await update(transform,message)} catch (failure){setFormError(failure.message)}
  }
  const modifyRecord = (draft,id,transform) => {
    const record=draft.records.find(record=>record.id===id)
    if (!record) throw new Error('This debt no longer exists. Reopen the record.')
    transform(record)
  }
  const create = async record => {
    await update(draft=>{
      draft.currency ||= currency
      if (!draft.records.some(entry=>entry.id===record.id)) draft.records.push(record)
    },'Debt added')
    setDirection(incoming(record)?'lent':'owe');navigate(url('debts'))
  }
  const saveEdits = async record => {
    await update(draft=>{
      if (draft.revision !== modal.revision) throw new Error('Debts changed. Reopen this debt to edit the latest version.')
      modifyRecord(draft,record.id,current=>Object.assign(current,record))
    },'Debt updated')
    setDirection(incoming(record)?'lent':'owe')
  }
  const savePayment = (recordId,itemId,payment) => {
    const term = records.find(record=>record.id===recordId)?.items.find(term=>term.id===itemId)
    return submit(async ()=>{
      if (!canEdit) throw new Error('You have view-only access.')
      setWorkspace(await api(`${path}/payments`,{method:'POST',...jsonBody({
        revision:workspace.revision,record_id:recordId,item_id:itemId,payment,
      })}))
    },term && payment.amount>left(term)?'Payment saved and schedule updated':'Payment saved')
  }
  async function changeReminder(record,lead) {
    setFormError('')
    try {
      await submit(async ()=>{
        if (spaceId) {
          const next = record ? {...alerts,rules:{...alerts.rules,[record.id]:lead}} : {...alerts,enabled:lead}
          setAlerts(await api(`${path}/alerts`,{method:'PUT',...jsonBody(next)}))
        } else {
          const draft=window.structuredClone(workspace)
          if (record) modifyRecord(draft,record.id,entry=>{entry.reminder=lead})
          else draft.enabled=lead
          setWorkspace(await api(path,{method:'PUT',...jsonBody(draft)}))
        }
      })
    } catch (problem) {setFormError(problem.message)}
  }
  const confirmDelete = async record => {
    if (await confirm(`Delete “${record.name}” and its debt payment history?`)) {
      await apply(draft=>{draft.records=draft.records.filter(row=>row.id!==record.id)},'Debt deleted')
    }
  }

  const heading = (name,key) => <div className="debt-heading"><h2>{name}</h2><InfoButton label={`About ${name.toLowerCase()}`} onClick={()=>setInfo(key)}/></div>
  const monthControl = (month,setMonth,label) => <label className="field"><span>Month</span><AppMonthField value={month} onChange={event=>setMonth(event.target.value)} aria-label={label} min="1900-01" max="2199-12" short required/></label>
  const scheduleRow = (record,term) => <Row key={term.id} icon={incoming(record)?ArrowDownLeft:CalendarDays} name={record.name}
    description={`${dayLabel(term.due)}${left(term)?incoming(record)?' · To receive':' · To pay':''}`} amount={fmt(term.covered_by?0:left(term)||term.amount)}
    status={paymentStatus(record,term,today)} onClick={()=>show('instalment',record,term)}/>
  const recordRow = record => {
    const first = open.find(entry=>entry.record.id===record.id)?.item
    return <Row key={record.id} icon={incoming(record)?ArrowDownLeft:record.kind==='loan'?Landmark:ArrowUpRight}
      name={record.name} description={first?`${first.due<today?'Overdue · ':'Due '}${dayLabel(first.due)}`:'Settled'}
      amount={fmt(remaining(record))} onClick={()=>show('record',record)}/>
  }
  const reminderRow = ({record,item:term,alert}) => <Row key={term.id} icon={Bell} name={record.name}
    description={`${alert<=today?'Ready · ':'Alert '}${dayLabel(alert)} · Due ${dayLabel(term.due)}`}
    status={paymentStatus(record,term,today)} onClick={()=>show('instalment',record,term)}/>
  const selectedHistory = range.flatMap(({record,item:term})=>term.payments.map(payment=>({record,term,payment})))
    .filter(({term,payment})=>(by==='actual'?payment.date.slice(0,7):term.month)===historyMonth)
    .sort((a,b)=>b.payment.date.localeCompare(a.payment.date))
  if (!workspace) return loadError ? <div className="form-error" role="alert">{loadError} <button type="button" className="button ghost" onClick={()=>setRetry(value=>value+1)}>Retry</button> <Link to={debtUrl()}>Open private Debt Management</Link></div>
    : <div className="skeleton-page" aria-label="Loading debts"><div/><div/><div/></div>

  const extraAmount = debtAmount(extra,currency)
  const estimated = tab==='payoff' ? payoffMonth(records,extraAmount||0,today) : null
  const base = tab==='payoff' ? payoffMonth(records,0,today) : null
  const alertPermission = async () => {
    try {await allowDebtAlerts();notify('Debt device alerts enabled')} catch (failure){setFormError(failure.message)}
  }
  return <div className="debt-workspace">
    {canEdit && ['debts','schedule','history'].includes(tab) && <PageActions floating><button type="button" className="transaction-fab" aria-label="Add an entry" title="Add an entry" onClick={()=>show('entry')}><Plus size={26} aria-hidden="true"/></button></PageActions>}
    {loadError && <p className="form-error" role="alert">{loadError} <button type="button" className="button ghost" onClick={()=>setRetry(value=>value+1)}>Retry</button></p>}
    {tab==='debts' && <div className="debt-home">
      <div>
        {next && <section className="debt-next" aria-label={direction==='lent'?'Next to receive':'Next to pay'}>
          <div><span className="debt-kicker">{direction==='lent'? <ArrowDownLeft size={16}/>:<CalendarDays size={16}/>} {direction==='lent'?'Next to receive':'Next to pay'}</span>
            <h2>{next.record.name}</h2><small>{dayLabel(next.item.due)}{next.item.due<today && <span className="debt-overdue"> · Overdue</span>}</small>
            <strong className="debt-next-amount">{fmt(left(next.item))}</strong></div>
        </section>}
        <div className="debt-balances" aria-label="Debt balances">
          {[['owe','I owe'],['lent','Owed to me']].map(([key,name])=><button type="button" key={key} className="debt-balance" data-incoming={key==='lent'} aria-pressed={direction===key} onClick={()=>setDirection(key)}>
            <small>{name}</small><strong>{fmt(sum(records.filter(record=>incoming(record)===(key==='lent')),remaining))}</strong></button>)}
        </div>
      </div>
      <section className="debt-listing">
        {heading(direction==='lent'?'Money lent':'Loans and borrowed money','debts')}
        {activeRecords.some(record=>remaining(record)>0) ? <ul className="debt-list">{activeRecords.filter(record=>remaining(record)>0).map(recordRow)}</ul>
          : <EmptyState title="Nothing outstanding" text={direction==='lent'?'Add money you lent with the + button.':'Add a loan or debt with the + button.'}/>}
        {activeRecords.some(record=>remaining(record)===0) && <details className="form-options"><summary>Settled</summary><ul className="debt-list">{activeRecords.filter(record=>remaining(record)===0).map(recordRow)}</ul></details>}
      </section>
    </div>}
    {tab==='schedule' && <div className="debt-narrow stack gap-12">
      <div className="debt-heading debt-schedule-control">{monthControl(scheduleMonth,setScheduleMonth,'Schedule month')}<InfoButton label="About the schedule" onClick={()=>setInfo('schedule')}/></div>
      {range.some(({item})=>item.month===scheduleMonth)?<ul className="debt-list">{range.filter(({item})=>item.month===scheduleMonth).sort((a,b)=>a.item.due.localeCompare(b.item.due)).map(({record,item})=>scheduleRow(record,item))}</ul>:
        <p className="muted">No instalments for this month.</p>}
    </div>}
    {tab==='history' && <div className="debt-narrow stack gap-12">
      <div className="debt-history-tools">{monthControl(historyMonth,setHistoryMonth,'History month')}
        <label className="field"><span>Show by</span><AppSelect value={by} onChange={event=>setBy(event.target.value)}><option value="actual">Actual date</option><option value="assigned">Payment month</option></AppSelect></label>
      </div>
      <div className="debt-history-help"><InfoButton label="About payment history" onClick={()=>setInfo('history')}/></div>
      {selectedHistory.length ? <ul className="debt-list">{selectedHistory.map(({record,term,payment})=><Row key={payment.id} icon={incoming(record)?ArrowDownLeft:Check} name={record.name}
        description={`${incoming(record)?'Received':'Paid'} ${dayLabel(payment.date)} · For ${monthLabel(term.month)}`} amount={fmt(payment.amount)} onClick={()=>show('instalment',record,term)}/>)}</ul>
        : <p className="muted">No payments match this month.</p>}
    </div>}
    {tab==='more' && <ul className="debt-list debt-narrow">{menu.map(([view,name,description,Icon])=><li key={view}><Link to={url(view)} className="debt-row">
      <span className="debt-row-icon"><Icon size={18} aria-hidden="true"/></span><span className="debt-row-label"><strong>{name}</strong><small>{description}</small></span><ChevronRight size={16} aria-hidden="true"/>
    </Link></li>)}</ul>}

    <Modal open={canEdit&&modal?.type==='entry'} onClose={close} title="Add an entry" size="small">
      <ul className="debt-list">
        <Row icon={Landmark} name="Add debt" description="Track a loan, money borrowed or money lent" onClick={()=>show('add')}/>
        <Row icon={Receipt} name="Record payment" description="Log money you paid or received" onClick={()=>show('pickPayment')}/>
      </ul>
    </Modal>
    <Modal open={canEdit&&modal?.type==='pickPayment'} onClose={close} title="Record payment" size="small">
      {open.length ? <ul className="debt-list">{records.filter(record=>remaining(record)>0).map(record=><Row key={record.id}
        icon={Receipt} name={record.name} description={incoming(record)?'Money received':'Money paid'} amount={fmt(remaining(record))}
        onClick={()=>show('payment',record,open.find(entry=>entry.record.id===record.id)?.item)}/>)}</ul> :
        <p className="muted">Add a debt to record a payment.</p>}
    </Modal>

    {canEdit&&(modal?.type==='add'||(['payment','edit'].includes(modal?.type)&&selected)) && <DebtEntryForm key={`${modal.type}:${modal.record}:${modal.item}`}
      mode={modal.type} direction={direction} record={selected} item={item} onClose={close} busy={busy} currency={currency} canLink={!spaceId&&!preview&&currency===personalCurrency} previewOnly={Boolean(preview)} onCreate={modal.type==='edit'?saveEdits:create} onPayment={savePayment}/>}
    <Modal open={modal?.type==='record'&&Boolean(selected)} onClose={close} title={selected?.name || 'Debt'} subtitle={selected&&[selected.person,debtKinds[selected.kind]].filter(Boolean).join(' · ')}>
      {selected && <div className="stack gap-12">
        <div className="debt-record-balance"><small>{incoming(selected)?'Still to receive':'Still to pay'}</small><strong>{fmt(remaining(selected))}</strong>
          <progress aria-label="Repayment progress" value={sum(selected.items,paid)} max={sum(selected.items,term=>term.amount)}/></div>
         {canEdit&&!preview&&<button type="button" className="button secondary" onClick={()=>show('edit',selected)}>Edit debt</button>}
        <h3>Instalments</h3>{selected.note&&<p className="muted">{selected.note}</p>}
        <ul className="debt-list">{selected.items.slice(0,expanded?selected.items.length:5).map(term=><Row key={term.id} icon={CalendarDays} name={monthLabel(term.month)}
          description={`Due ${dayLabel(term.due)}`} amount={fmt(term.covered_by?0:left(term)||term.amount)} status={paymentStatus(selected,term,today)} onClick={()=>show('instalment',selected,term)}/>)}</ul>
        {!expanded&&selected.items.length>5&&<button type="button" className="button ghost" onClick={()=>setExpanded(true)}>Show all {selected.items.length} instalments</button>}
        {canEdit&&!preview&&<details className="form-options"><summary>More options</summary><button type="button" className="button danger" onClick={()=>void confirmDelete(selected)}>Delete debt</button></details>}
        {formError&&<p className="form-error" role="alert">{formError}</p>}
      </div>}
    </Modal>
    <Modal open={modal?.type==='instalment'&&Boolean(item)} onClose={close} title={item?monthLabel(item.month):'Instalment'} subtitle={selected?.name}>
      {selected&&item&&<div className="stack gap-12">
        <dl className="debt-data"><dt>Payment month</dt><dd>{monthLabel(item.month)}</dd><dt>Due date</dt><dd>{dayLabel(item.due)}</dd>
          <dt>Scheduled amount</dt><dd>{fmt(item.amount)}</dd><dt>{incoming(selected)?'Received so far':'Paid so far'}</dt><dd>{fmt(paid(item))}</dd><dt>Left for this month</dt><dd>{fmt(left(item))}</dd></dl>
        {left(item)>0&&canEdit&&!preview&&<div className="button-row"><button type="button" className="button ghost" onClick={()=>show('due',selected,item)}>Change due date</button></div>}
        <h3>{incoming(selected)?'Receipts':'Payments'}</h3>
        {item.payments.length?<ul className="debt-list">{item.payments.slice().sort((a,b)=>b.date.localeCompare(a.date)).map(payment=><li key={payment.id} className="debt-payment-line"><span>{dayLabel(payment.date)}
          {payment.note&&<small>{payment.note}</small>}{payment.transaction_id&&<small>Linked Personal transaction</small>}</span><strong>{fmt(payment.amount)}</strong></li>)}</ul>
          :!item.covered_by&&<p className="muted">No payments recorded for this month.</p>}
        {item.covered_by&&<p className="muted">Covered by the extra payment for {monthLabel(item.covered_by)}.</p>}
        <button type="button" className="button ghost" onClick={()=>show('record',selected)}>Back to debt</button>
      </div>}
    </Modal>
    <Modal open={Boolean(modal?.type==='due'&&selected&&canEdit&&!preview)} onClose={close} size="small" title="Change due date" subtitle={selected?.name} layerClass="debt-entry-layer">
      {selected&&modal?.type==='due'&&<form className="stack gap-12 transaction-form" onSubmit={event=>{
        event.preventDefault()
        if (!edit) {setFormError('Choose a due date.');return}
        void apply(draft=>modifyRecord(draft,selected.id,record=>{
          const term=record.items.find(row=>row.id===item?.id)
          if (!term || left(term)<=0) throw new Error('This instalment is no longer open.')
          term.due=edit
        }),'Due date updated')
      }}>
        <DateField label="New due date" value={edit} onChange={setEdit} disabled={busy} min="1900-01-01" max="2199-12-31"/>
        {formError&&<p className="form-error" role="alert">{formError}</p>}
        <button type="submit" className="button primary" disabled={busy}>{busy?'Saving…':'Save date'}</button>
      </form>}
    </Modal>
    {tab==='reminders' && <div className="debt-narrow stack gap-12">
        <label className="check-row"><input type="checkbox" role="switch" checked={enabled} disabled={busy||Boolean(preview)||Boolean(spaceId&&!alerts)}
          onChange={event=>void changeReminder(null,event.target.checked)}/>My debt alerts</label>
        {heading('Upcoming alerts','reminders')}
        {reminders.length?<ul className="debt-list">{reminders.map(reminderRow)}</ul>:<p className="muted">{spaceId&&!alerts?'Loading alerts…':enabled?'No alerts scheduled.':'Your debt alerts are paused.'}</p>}
        {open.length>0&&<><h3>Remind me for each debt</h3>
        <div className="stack gap-12">{records.filter(record=>remaining(record)>0).map(record=><div className="debt-reminder-rule" key={record.id}>
          <strong>{record.name}</strong><DebtReminderField label={`Reminder for ${record.name}`} hideLabel value={reminderLead(record)} disabled={busy||Boolean(preview)||Boolean(spaceId&&!alerts)}
            onChange={lead=>void changeReminder(record,lead)}/>
        </div>)}</div></>}
        {!preview&&<div><button type="button" className="button ghost" onClick={()=>void alertPermission()}>Allow device alerts</button></div>}
        {formError&&<p className="form-error" role="alert">{formError}</p>}
    </div>}
    {tab==='payoff' && <div className="debt-narrow stack gap-12">
        <div className="debt-heading"><label className="field"><span>Extra each month ({currency})</span><input inputMode="decimal" value={extra} onChange={event=>setExtra(event.target.value)} placeholder="0"/></label>
          <InfoButton label="About the debt-free estimate" onClick={()=>setInfo('payoff')}/></div>
        <div className="debt-record-balance" role="status">{extra.trim()&&Number.isNaN(extraAmount)?<p className="form-error">Enter an amount in {currency}.</p>:<>
          <small>Estimated debt-free month</small><strong>{estimated?monthLabel(estimated):'No debts left to pay'}</strong>
          {base&&<small>With your current schedule · {monthLabel(base)}</small>}
        </>}</div>
    </div>}
    <Modal open={Boolean(info)} onClose={()=>setInfo('')} title={explanations[info]?.[0] || 'About debts'} size="small"><p>{explanations[info]?.[1]}</p></Modal>
  </div>
}
