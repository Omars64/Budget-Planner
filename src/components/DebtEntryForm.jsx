import { useEffect, useId, useState } from 'react'
import { ArrowDownLeft, ArrowUpRight, Landmark } from 'lucide-react'
import AppMonthField from './AppMonthField'
import AppSelect from './AppSelect'
import { DateField } from './DateTimeField'
import Modal from './Modal'
import InfoButton from './InfoButton'
import { api, money } from '../lib/api'
import { currencyPlaceholder } from '../lib/currency'
import { dateKey } from '../lib/time'
import { debtAmount, debtKinds, debtPath, dayLabel, incoming, left, makeSchedule, monthLabel, reminderLeads } from '../lib/debtWorkspace'

const kindIcons = { loan:Landmark, borrowed:ArrowUpRight, lent:ArrowDownLeft }
const readReminder = value => value === '' ? null : Number(value)
export function DebtReminderField({value,onChange,disabled}) {
  return <label className="field"><span>Remind me</span><AppSelect disabled={disabled} value={value ?? ''} onChange={e=>onChange(readReminder(e.target.value))}>
    {reminderLeads.map(([days,label])=><option key={label} value={days ?? ''}>{label}</option>)}
  </AppSelect></label>
}

export default function DebtEntryForm({mode, record, item, direction, currency, canLink, busy, onClose, onCreate, onPayment}) {
  const adding = mode === 'add'
  const choices = record?.items.filter(row=>left(row)>0) || []
  const first = choices.find(row=>row.id===item?.id) || choices[0]
  const [form,setForm] = useState(()=>({kind:direction==='lent'?'lent':'loan',name:'',person:'',amount:first?String(left(first)/1000):'',
    date:dateKey(),due:dateKey(),month:'',frequency:'once',monthly:'',apr:'0',note:'',reminder:null,item:first?.id || '',transaction:''}))
  const [error,setError] = useState('')
  const [help,setHelp] = useState(false)
  const [matches,setMatches] = useState(null)
  const [looking,setLooking] = useState(false)
  const [searchLinks,setSearchLinks] = useState(false)
  const [entryId] = useState(()=>crypto.randomUUID())
  const formId = useId()
  const receipt = record && incoming(record)
  const selection = choices.find(row=>row.id===form.item)
  const rawAmount = debtAmount(form.amount,currency)
  const set = (key,value) => {
    setForm(current=>({...current,[key]:value,...(['amount','date'].includes(key)?{transaction:''}:{})}))
    setError('')
  }
  useEffect(()=>{
    if (!searchLinks || adding || !canLink || !(rawAmount>0) || !form.date) return
    const controller = new AbortController()
    const params = new URLSearchParams({direction:receipt?'income':'expense',amount:rawAmount,day:form.date})
    setLooking(true); setMatches(null)
    api(`${debtPath}/linkable?${params}`,{signal:controller.signal}).then(setMatches).catch(failure=>{
      if (!controller.signal.aborted) setMatches({error:failure.message})
    }).finally(()=>{if (!controller.signal.aborted) setLooking(false)})
    return ()=>controller.abort()
  },[searchLinks,adding,canLink,receipt,rawAmount,form.date])

  async function save(event) {
    event.preventDefault()
    if (busy) return
    setError('')
    if (!(rawAmount>0)) { setError('Enter an amount greater than zero.'); return }
    try {
      if (adding) {
        if (!form.name.trim() || !form.due) throw new Error('Enter a name and the first due date.')
        const monthly = form.frequency === 'monthly' ? debtAmount(form.monthly,currency) : rawAmount
        const apr = form.frequency === 'monthly' && form.kind === 'loan' ? Number(form.apr) : 0
        if (!(monthly>0) || !Number.isFinite(apr) || apr<0 || apr>100) throw new Error('Check the monthly payment and interest rate.')
        const items = makeSchedule({ opening:rawAmount, monthly, apr, month:form.month||form.due.slice(0,7), due:form.due },currency)
        await onCreate({id:entryId,kind:form.kind,name:form.name.trim(),person:form.person.trim(),opening:rawAmount,apr,items,note:form.note.trim(),reminder:form.reminder})
      } else {
        if (!selection || rawAmount>left(selection)) throw new Error('The amount must fit what is left for this month.')
        if (!form.date || form.date>dateKey()) throw new Error('Choose the date the money moved.')
        await onPayment(record.id,selection.id,{id:entryId,amount:rawAmount,date:form.date,note:form.note.trim(),transaction_id:Number(form.transaction)||null})
      }
    } catch (failure) { setError(failure.message) }
  }
  const heading = adding?'Add debt':receipt?'Record money received':'Record a payment'
  return <>
    <Modal open onClose={()=>!busy && onClose()} protectChanges title={heading} subtitle={record?.name} layerClass="debt-entry-layer"
      footer={close=><div className="modal-actions"><button type="button" className="button ghost" disabled={busy} onClick={close}>Cancel</button>
        <button className="button primary" form={formId} type="submit" disabled={busy}>{busy?'Saving…':adding?'Save debt':receipt?'Save receipt':'Save payment'}</button></div>}>
      <form id={formId} onSubmit={save} className="stack gap-18 transaction-form">
        <fieldset className="stack gap-16" disabled={busy}>
          {adding && <div className="segment-control three" role="group" aria-label="Debt type">
            {Object.entries(debtKinds).map(([kind,label])=>{const Icon=kindIcons[kind];return <button type="button" key={kind} aria-pressed={form.kind===kind} className={form.kind===kind?'active':''} onClick={()=>set('kind',kind)}><Icon size={16}/>{label}</button>})}
          </div>}
          <label className="amount-input"><span>{adding?`Amount still owed (${currency})`:receipt?`Amount received (${currency})`:`Amount paid (${currency})`}</span>
            <input inputMode="decimal" autoComplete="off" value={form.amount} onChange={e=>set('amount',e.target.value)} placeholder={currencyPlaceholder(currency)}/>
          </label>
          {adding ? <>
            <label className="field"><span>Name</span><input value={form.name} onChange={e=>set('name',e.target.value)} maxLength={120} placeholder="e.g. Car loan"/></label>
            <DateField label="First due date" value={form.due} onChange={value=>set('due',value)} min="1900-01-01" max="2199-12-31" disabled={busy}/>
            <label className="field"><span>Pay it back</span><AppSelect value={form.frequency} onChange={e=>set('frequency',e.target.value)}><option value="once">In one payment</option><option value="monthly">Every month</option></AppSelect></label>
            {form.frequency==='monthly' && <div className="form-grid two">
              <label className="field"><span>Monthly payment ({currency})</span><input inputMode="decimal" value={form.monthly} onChange={e=>set('monthly',e.target.value)}/></label>
              {form.kind==='loan' && <label className="field"><span>Annual interest (%)</span><input type="number" min="0" max="100" step=".01" value={form.apr} onChange={e=>set('apr',e.target.value)}/></label>}
            </div>}
          </> : <>
            <label className="field"><span>Payment month</span><AppSelect value={form.item} onChange={e=>{
              const target = choices.find(row=>row.id===e.target.value)
              if (target) {setForm(current=>({...current,item:target.id,amount:String(left(target)/1000),transaction:''}));setError('')}
            }}>{choices.map(row=><option key={row.id} value={row.id}>{monthLabel(row.month)}</option>)}</AppSelect></label>
            {selection && <small className="muted">Due {dayLabel(selection.due)} · {money(left(selection)/1000,currency)} left</small>}
            <DateField label={receipt?'Date received':'Date paid'} value={form.date} onChange={value=>set('date',value)} max={dateKey()} min="1900-01-01" disabled={busy}/>
          </>}
          <div className="debt-form-help"><InfoButton label={adding?'About repayment schedules':'About payment dates'} onClick={()=>setHelp(true)}/></div>
          <details className="form-options" onToggle={event=>{if (!adding) setSearchLinks(event.currentTarget.open)}}>
            <summary>More options</summary><div className="stack gap-16">
              {adding && <>
                <label className="field"><span>Person or lender (optional)</span><input value={form.person} onChange={e=>set('person',e.target.value)} maxLength={120}/></label>
                <label className="field"><span>First payment month</span><AppMonthField value={form.month} onChange={e=>set('month',e.target.value)} min="1900-01" max="2199-12" emptyLabel="Use the due date month"/></label>
                <DebtReminderField value={form.reminder} disabled={busy} onChange={value=>set('reminder',value)}/>
              </>}
              <label className="field"><span>Notes (optional)</span><textarea rows={3} maxLength={adding?500:240} value={form.note} onChange={e=>set('note',e.target.value)}/></label>
              {!adding && canLink && <label className="field"><span>Link a Personal transaction (optional)</span>
                <AppSelect value={form.transaction} onChange={e=>set('transaction',e.target.value)} disabled={busy || looking || !Array.isArray(matches) || !matches.length}><option value="">{looking?'Finding matches…':Array.isArray(matches)&&matches.length?'Choose a transaction':'No matching transactions'}</option>
                  {Array.isArray(matches)&&matches.map(entry=><option key={entry.id} value={entry.id}>{entry.description}</option>)}</AppSelect>
                {matches?.error && <small className="muted">{matches.error}</small>}
              </label>}
            </div>
          </details>
          {error && <p className="form-error" role="alert">{error}</p>}
        </fieldset>
      </form>
    </Modal>
    <Modal open={help} onClose={()=>setHelp(false)} size="small" title={adding?'Repayment schedules':'Payment month and date'}>
      <p>{adding?'Monthly loans use estimated interest to build a schedule. You can set a payment month separately from the due date.':
        'The payment month is the instalment this covers. The payment date is when the money moved. Link a matching Personal transaction to keep just one ledger entry.'}</p>
    </Modal>
  </>
}
