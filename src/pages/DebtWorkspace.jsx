import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { ArrowDownLeft, ArrowUpRight, Bell, CalendarDays, Check, ChevronLeft, ChevronRight, Landmark, Plus } from 'lucide-react'
import { useApp } from '../App'
import { api, jsonBody, money } from '../lib/api'
import { dateKey } from '../lib/time'
import { allItems, dayLabel, debtAmount, debtChanged, debtKinds, debtPath, incoming, left, monthLabel,
  openItems, paid, paymentStatus, payoffMonth, remaining, shiftDay, shiftMonth, sum } from '../lib/debtWorkspace'
import { allowDebtAlerts } from '../lib/debtNotifications'
import AppMonthField from '../components/AppMonthField'
import AppSelect from '../components/AppSelect'
import { DateField } from '../components/DateTimeField'
import DebtEntryForm, { DebtReminderField } from '../components/DebtEntryForm'
import EmptyState from '../components/EmptyState'
import InfoButton from '../components/InfoButton'
import Modal from '../components/Modal'
import PageActions from '../components/PageActions'
import './DebtWorkspace.css'

const explanations = {
  debts:['About Debt Management','Track what you owe and what is owed to you here. Loans include the interest in your schedule. Logging a payment updates this workspace. You can link a matching Personal transaction in More options.'],
  schedule:['About your schedule','The payment month identifies which instalment this covers. The due date can fall in a different month. Open an instalment to see its payments or change its due date.'],
  history:['About payment history','Actual date shows when the money moved. Payment month shows the instalment that the payment covers.'],
  reminders:['About debt reminders','These reminders use your debt due dates and are only for you. Paid instalments clear from the list. Device alerts on Android can arrive when Budgetly is closed. Browser and Windows alerts require Budgetly to be open.'],
  payoff:['About the estimate','This uses your current repayment schedule and applies extra payments to the highest interest rate first. Scheduled interest stays fixed in the estimate. Your lender may recalculate it. Money owed to you is excluded.'],
}
const Row = ({icon:Icon,name,description,amount,status,onClick}) => <li><button type="button" className="debt-row" onClick={onClick}>
  <span className="debt-row-icon"><Icon size={18}/></span><span className="debt-row-label"><strong>{name}</strong><small>{description}</small></span>
  <span className="debt-row-tail">{amount && <strong>{amount}</strong>}{status ? <small>{status}</small> : !amount && <ChevronRight size={16}/>}</span>
</button></li>

export default function DebtWorkspace() {
  const { accountSettings, settings, notify, confirm, refreshKey } = useApp()
  const location = useLocation()
  const personalCurrency = accountSettings?.currency || settings.currency || 'KWD'
  const today = dateKey(), currentMonth = today.slice(0,7)
  const [workspace,setWorkspace] = useState(null)
  const [loadError,setLoadError] = useState('')
  const [retry,setRetry] = useState(0)
  const [busy,setBusy] = useState(false)
  const saving = useRef(false)
  const request = useRef(null)
  const [tab,setTab] = useState('debts')
  const [direction,setDirection] = useState('owe')
  const [scheduleMonth,setScheduleMonth] = useState(currentMonth)
  const [historyMonth,setHistoryMonth] = useState(currentMonth)
  const [by,setBy] = useState('actual')
  const [modal,setModal] = useState(()=>location.state?.debtReminders?{type:'reminders'}:null)
  const [info,setInfo] = useState('')
  const [extra,setExtra] = useState('')
  const [formError,setFormError] = useState('')
  const [edit,setEdit] = useState('')
  const [expanded,setExpanded] = useState(false)
  const lastLocation = useRef(location.key)

  useEffect(()=>{
    if (lastLocation.current !== location.key && location.state?.debtReminders) setModal({type:'reminders'})
    lastLocation.current=location.key
  },[location.key,location.state])
  useEffect(()=>{
    const controller = new AbortController()
    request.current=controller
    setLoadError('')
    api(debtPath,{signal:controller.signal}).then(data=>{if (!controller.signal.aborted) setWorkspace(data)})
      .catch(failure=>{if (!controller.signal.aborted) setLoadError(failure.message)})
    return ()=>{controller.abort();if (request.current===controller) request.current=null}
  },[retry,refreshKey])

  const records = workspace?.records || []
  const currency = workspace?.currency || personalCurrency
  const fmt = amount => money(amount/1000,currency)
  const range = allItems(records)
  const open = openItems(records)
  const activeRecords = records.filter(record=>incoming(record)===(direction==='lent'))
  const next = open.find(({record})=>incoming(record)===(direction==='lent'))
  const reminders = workspace?.enabled ? open.filter(({record,item})=>record.reminder!==null && shiftDay(item.due,-record.reminder)<=today) : []
  const future = workspace?.enabled ? open.filter(({record,item})=>record.reminder!==null && shiftDay(item.due,-record.reminder)>today)
    .sort((a,b)=>shiftDay(a.item.due,-a.record.reminder).localeCompare(shiftDay(b.item.due,-b.record.reminder)))
    .filter(({record},index,entries)=>entries.findIndex(entry=>entry.record.id===record.id)===index) : []
  const selected = records.find(record=>record.id===modal?.record)
  const item = selected?.items.find(entry=>entry.id===modal?.item)
  const close = () => {if (!saving.current){setModal(null);setFormError('')}}
  const show = (type,record,target) => {
    setEdit(type==='due'?target.due:type==='rule'?record.reminder:'')
    setFormError('');setExpanded(false)
    setModal({type,record:record?.id,item:target?.id})
  }

  async function update(transform,message) {
    if (saving.current || !workspace) throw new Error('Finish the current save first.')
    saving.current=true;setBusy(true)
    try {
      const draft=window.structuredClone(workspace)
      transform(draft)
      request.current?.abort()
      const value=await api(debtPath,{method:'PUT',...jsonBody(draft)})
      setWorkspace(value)
      window.dispatchEvent(new CustomEvent(debtChanged,{detail:value}))
      if (message) {setModal(null);notify(message)}
    } catch (failure) {
      if (failure.status===409) setRetry(value=>value+1)
      throw failure
    } finally {saving.current=false;setBusy(false)}
  }
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
    setDirection(incoming(record)?'lent':'owe');setTab('debts')
  }
  const savePayment = (recordId,itemId,payment) => update(draft=>modifyRecord(draft,recordId,record=>{
    const term=record.items.find(row=>row.id===itemId)
    if (record.items.some(row=>row.payments.some(entry=>entry.id===payment.id))) return
    if (!term || payment.amount>left(term)) throw new Error('The amount left changed. Check the payment month and amount.')
    term.payments.push(payment)
  }),'Payment recorded')
  const confirmDelete = async record => {
    if (await confirm(`Delete “${record.name}” and its debt payment history?`)) {
      await apply(draft=>{draft.records=draft.records.filter(row=>row.id!==record.id)},'Debt deleted')
    }
  }

  const heading = (name,key) => <div className="debt-heading"><h2>{name}</h2><InfoButton label={`About ${name.toLowerCase()}`} onClick={()=>setInfo(key)}/></div>
  const monthControl = (month,setMonth,label) => <div className="debt-month">
    <button type="button" className="icon-button" aria-label="Previous month" disabled={month<='1900-01'} onClick={()=>setMonth(shiftMonth(month,-1))}><ChevronLeft size={18}/></button>
    <AppMonthField value={month} onChange={event=>setMonth(event.target.value)} aria-label={label} min="1900-01" max="2199-12" required/>
    <button type="button" className="icon-button" aria-label="Next month" disabled={month>='2199-12'} onClick={()=>setMonth(shiftMonth(month,1))}><ChevronRight size={18}/></button>
  </div>
  const scheduleRow = (record,term) => <Row key={term.id} icon={incoming(record)?ArrowDownLeft:CalendarDays} name={record.name}
    description={`${dayLabel(term.due)} · ${incoming(record)?'To receive':'To pay'}`} amount={fmt(left(term)||term.amount)}
    status={paymentStatus(record,term,today)} onClick={()=>show('instalment',record,term)}/>
  const recordRow = record => {
    const first = open.find(entry=>entry.record.id===record.id)?.item
    return <Row key={record.id} icon={incoming(record)?ArrowDownLeft:record.kind==='loan'?Landmark:ArrowUpRight}
      name={record.name} description={first?`${first.due<today?'Overdue · ':'Due '}${dayLabel(first.due)}`:'Settled'}
      amount={fmt(remaining(record))} onClick={()=>show('record',record)}/>
  }
  const reminderRow = ({record,item:term},ready) => <Row key={term.id} icon={Bell} name={record.name}
    description={`${ready?'Due ':'Reminder '}${dayLabel(ready?term.due:shiftDay(term.due,-record.reminder))} · For ${monthLabel(term.month)}`}
    status={paymentStatus(record,term,today)} onClick={()=>show('instalment',record,term)}/>
  const selectedHistory = range.flatMap(({record,item:term})=>term.payments.map(payment=>({record,term,payment})))
    .filter(({term,payment})=>(by==='actual'?payment.date.slice(0,7):term.month)===historyMonth)
    .sort((a,b)=>b.payment.date.localeCompare(a.payment.date))
  if (!workspace) return loadError ? <div className="form-error" role="alert">{loadError} <button type="button" className="button ghost" onClick={()=>setRetry(value=>value+1)}>Retry</button></div>
    : <div className="skeleton-page" aria-label="Loading debts"><div/><div/><div/></div>

  const estimated = modal?.type==='payoff' ? payoffMonth(records,debtAmount(extra,currency)||0,today) : null
  const base = modal?.type==='payoff' ? payoffMonth(records,0,today) : null
  const editModal = modal?.type==='rule'||modal?.type==='due'
  const alertPermission = async () => {
    try {await allowDebtAlerts();notify('Debt device alerts enabled')} catch (failure){setFormError(failure.message)}
  }
  return <div className="debt-workspace">
    <PageActions floating><button type="button" className="transaction-fab" aria-label="Add debt" title="Add debt" onClick={()=>show('add')}><Plus size={26} aria-hidden="true"/></button></PageActions>
    {loadError && <p className="form-error" role="alert">{loadError} <button type="button" className="button ghost" onClick={()=>setRetry(value=>value+1)}>Retry</button></p>}
    <nav className="debt-tabs" aria-label="Debt Management views">
      {Object.entries({debts:'Debts',schedule:'Schedule',history:'History'}).map(([key,name])=><button type="button" key={key} className="button ghost" aria-current={tab===key?'page':undefined} onClick={()=>setTab(key)}>{name}</button>)}
    </nav>
    {tab==='debts' && <div className="debt-home">
      <div>
        {next && <section className="debt-next" aria-label={direction==='lent'?'Next to receive':'Next to pay'}>
          <div><span className="debt-kicker">{direction==='lent'? <ArrowDownLeft size={16}/>:<CalendarDays size={16}/>} {direction==='lent'?'Next to receive':'Next to pay'}</span>
            <h2>{next.record.name}</h2><small>{dayLabel(next.item.due)}{next.item.due<today && <span className="debt-overdue"> · Overdue</span>}</small>
            <strong className="debt-next-amount">{fmt(left(next.item))}</strong></div>
          <button type="button" className="button primary" onClick={()=>show('payment',next.record,next.item)}>{direction==='lent'?'Log receipt':'Log payment'}</button>
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
    {tab==='schedule' && <div className="stack gap-12">
      {heading('Repayment schedule','schedule')}{monthControl(scheduleMonth,setScheduleMonth,'Schedule month')}
      {open.some(({item})=>item.month!==scheduleMonth && item.due<today) && <small className="debt-overdue">Overdue instalments from other months are listed in Debt reminders.</small>}
      {range.some(({item})=>item.month===scheduleMonth)?<ul className="debt-list">{range.filter(({item})=>item.month===scheduleMonth).sort((a,b)=>a.item.due.localeCompare(b.item.due)).map(({record,item})=>scheduleRow(record,item))}</ul>:
        <p className="muted">No instalments for this month.</p>}
    </div>}
    {tab==='history' && <div className="stack gap-12">
      {heading('Payment history','history')}
      <div className="debt-history-tools">{monthControl(historyMonth,setHistoryMonth,'History month')}
        <label className="field"><span>Show by</span><AppSelect value={by} onChange={event=>setBy(event.target.value)}><option value="actual">Actual date</option><option value="assigned">Payment month</option></AppSelect></label></div>
      {selectedHistory.length ? <ul className="debt-list">{selectedHistory.map(({record,term,payment})=><Row key={payment.id} icon={incoming(record)?ArrowDownLeft:Check} name={record.name}
        description={`${incoming(record)?'Received':'Paid'} ${dayLabel(payment.date)} · For ${monthLabel(term.month)}`} amount={fmt(payment.amount)} onClick={()=>show('instalment',record,term)}/>)}</ul>
        : <p className="muted">No payments match this month.</p>}
    </div>}
    <div className="debt-tools"><button type="button" className="button ghost" onClick={()=>show('reminders')}><Bell size={17}/>Debt reminders{reminders.length>0&&<span className="debt-count">{reminders.length}</span>}</button>
      {tab==='debts' && direction==='owe' && next && <button type="button" className="button ghost" onClick={()=>{setExtra('');show('payoff')}}>Debt-free calculator</button>}</div>

    {(modal?.type==='add'||(modal?.type==='payment'&&selected)) && <DebtEntryForm key={`${modal.type}:${modal.record}:${modal.item}`}
      mode={modal.type} direction={direction} record={selected} item={item} onClose={close} busy={busy} currency={currency} canLink={currency===personalCurrency} onCreate={create} onPayment={savePayment}/>}
    <Modal open={modal?.type==='record'&&Boolean(selected)} onClose={close} title={selected?.name || 'Debt'} subtitle={selected&&[selected.person,debtKinds[selected.kind]].filter(Boolean).join(' · ')}>
      {selected && <div className="stack gap-12">
        <div className="debt-record-balance"><small>{incoming(selected)?'Still to receive':'Still to pay'}</small><strong>{fmt(remaining(selected))}</strong>
          <progress aria-label="Repayment progress" value={sum(selected.items,paid)} max={sum(selected.items,term=>term.amount)}/></div>
        <div className="button-row">{remaining(selected)>0&&<><button type="button" className="button primary" onClick={()=>show('payment',selected)}>{incoming(selected)?'Record received':'Record payment'}</button><button type="button" className="button ghost" onClick={()=>show('rule',selected)}>Reminder</button></>}</div>
        <h3>Instalments</h3>{selected.note&&<p className="muted">{selected.note}</p>}
        <ul className="debt-list">{selected.items.slice(0,expanded?selected.items.length:5).map(term=><Row key={term.id} icon={CalendarDays} name={monthLabel(term.month)}
          description={`Due ${dayLabel(term.due)}`} amount={fmt(left(term)||term.amount)} status={paymentStatus(selected,term,today)} onClick={()=>show('instalment',selected,term)}/>)}</ul>
        {!expanded&&selected.items.length>5&&<button type="button" className="button ghost" onClick={()=>setExpanded(true)}>Show all {selected.items.length} instalments</button>}
        <details className="form-options"><summary>More options</summary><button type="button" className="button danger" onClick={()=>void confirmDelete(selected)}>Delete debt</button></details>
        {formError&&<p className="form-error" role="alert">{formError}</p>}
      </div>}
    </Modal>
    <Modal open={modal?.type==='instalment'&&Boolean(item)} onClose={close} title={item?monthLabel(item.month):'Instalment'} subtitle={selected?.name}>
      {selected&&item&&<div className="stack gap-12">
        <dl className="debt-data"><dt>Payment month</dt><dd>{monthLabel(item.month)}</dd><dt>Due date</dt><dd>{dayLabel(item.due)}</dd>
          <dt>Scheduled amount</dt><dd>{fmt(item.amount)}</dd><dt>{incoming(selected)?'Received so far':'Paid so far'}</dt><dd>{fmt(paid(item))}</dd><dt>Left for this month</dt><dd>{fmt(left(item))}</dd></dl>
        {left(item)>0&&<div className="button-row"><button type="button" className="button primary" onClick={()=>show('payment',selected,item)}>{incoming(selected)?'Record received':'Record payment'}</button>
          <button type="button" className="button ghost" onClick={()=>show('due',selected,item)}>Change due date</button></div>}
        <h3>{incoming(selected)?'Receipts':'Payments'}</h3>
        {item.payments.length?<ul className="debt-list">{item.payments.slice().sort((a,b)=>b.date.localeCompare(a.date)).map(payment=><li key={payment.id} className="debt-payment-line"><span>{dayLabel(payment.date)}
          {payment.note&&<small>{payment.note}</small>}{payment.transaction_id&&<small>Linked Personal transaction</small>}</span><strong>{fmt(payment.amount)}</strong></li>)}</ul>
          :<p className="muted">No payments recorded for this month.</p>}
        <button type="button" className="button ghost" onClick={()=>show('record',selected)}>Back to debt</button>
      </div>}
    </Modal>
    <Modal open={Boolean(editModal&&selected)} onClose={close} size="small" title={modal?.type==='due'?'Change due date':'Payment reminder'} subtitle={selected?.name} layerClass="debt-entry-layer">
      {selected&&editModal&&<form className="stack gap-12 transaction-form" onSubmit={event=>{
        event.preventDefault()
        if (modal.type==='due' && !edit) {setFormError('Choose a due date.');return}
        void apply(draft=>modifyRecord(draft,selected.id,record=>{
          if (modal.type==='rule') record.reminder=edit
          else {
            const term=record.items.find(row=>row.id===item?.id)
            if (!term || left(term)<=0) throw new Error('This instalment is no longer open.')
            term.due=edit
          }
        }),modal.type==='due'?'Due date updated':'Reminder saved')
      }}>
        {modal.type==='due'?<DateField label="New due date" value={edit} onChange={setEdit} disabled={busy} min="1900-01-01" max="2199-12-31"/>:
          <DebtReminderField value={edit} onChange={setEdit} disabled={busy}/>}
        {formError&&<p className="form-error" role="alert">{formError}</p>}
        <button type="submit" className="button primary" disabled={busy}>{busy?'Saving…':modal.type==='due'?'Save due date':'Save reminder'}</button>
      </form>}
    </Modal>
    <Modal open={modal?.type==='reminders'} onClose={close} title="Debt reminders">
      <div className="stack gap-12">
        <div className="debt-heading"><label className="check-row"><input type="checkbox" role="switch" checked={workspace.enabled} disabled={busy}
          onChange={event=>{const enabled=event.target.checked;void apply(draft=>{draft.enabled=enabled})}}/>Debt notifications</label><InfoButton label="About debt reminders" onClick={()=>setInfo('reminders')}/></div>
        <h3>Needs attention</h3>{reminders.length?<ul className="debt-list">{reminders.map(entry=>reminderRow(entry,true))}</ul>:<p className="muted">{workspace.enabled?'No reminders due.':'Debt notifications are paused.'}</p>}
        {future.length>0&&<><h3>Next reminder for each debt</h3><ul className="debt-list">{future.map(entry=>reminderRow(entry,false))}</ul></>}
        <h3>Reminder settings</h3>
        <ul className="debt-list">{records.filter(record=>remaining(record)>0).map(record=><Row key={record.id} icon={Bell} name={record.name}
          description={record.reminder===null?'Off':record.reminder===0?'On the due date':`${record.reminder} day${record.reminder===1?'':'s'} before`} onClick={()=>show('rule',record)}/>)}</ul>
        <button type="button" className="button ghost" onClick={()=>void alertPermission()}>Allow device alerts</button>
        {formError&&<p className="form-error" role="alert">{formError}</p>}
      </div>
    </Modal>
    <Modal open={modal?.type==='payoff'} onClose={close} title="Debt-free calculator" size="small">
      <div className="stack gap-12">
        <div className="debt-heading"><label className="field"><span>Extra per month ({currency})</span><input inputMode="decimal" value={extra} onChange={event=>setExtra(event.target.value)} placeholder="0"/></label>
          <InfoButton label="About the debt-free estimate" onClick={()=>setInfo('payoff')}/></div>
        <div className="debt-record-balance" role="status"><small>Estimated debt-free month</small><strong>{estimated?monthLabel(estimated):'Beyond the estimate'}</strong></div>
        <p className="muted">With scheduled payments alone · {base?monthLabel(base):'Beyond the estimate'}</p>
      </div>
    </Modal>
    <Modal open={Boolean(info)} onClose={()=>setInfo('')} title={explanations[info]?.[0] || 'About debts'} size="small"><p>{explanations[info]?.[1]}</p></Modal>
  </div>
}
