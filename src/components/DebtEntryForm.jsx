import { useEffect, useId, useState } from 'react'
import AppMonthField from './AppMonthField'
import AppSelect from './AppSelect'
import { DateField } from './DateTimeField'
import Modal from './Modal'
import InfoButton from './InfoButton'
import { api, money } from '../lib/api'
import { CategoryIcon } from '../lib/categoryIcons'
import { currencyPlaceholder } from '../lib/currency'
import { dateKey } from '../lib/time'
import { debtAmount, debtPath, extraPaymentChange, incoming, left, makeSchedule, monthLabel, preserveDebtPayments, reminderLeads, sum } from '../lib/debtWorkspace'

const kinds = [['borrowed','Money I borrowed'],['loan','A loan'],['lent','Money I lent']]
const readReminder = value => value === '' ? null : Number(value)
export function DebtReminderField({value,onChange,disabled,label='Remind me',hideLabel=false}) {
  return <label className="field"><span className={hideLabel?'sr-only':undefined}>{label}</span><AppSelect aria-label={label} disabled={disabled} value={value ?? ''} onChange={e=>onChange(readReminder(e.target.value))}>
    {reminderLeads.map(([days,label])=><option key={label} value={days ?? ''}>{label}</option>)}
  </AppSelect></label>
}

export default function DebtEntryForm({mode, record, item, direction, currency, canLink, busy, previewOnly, onClose, onCreate, onPayment}) {
  const editing = mode === 'edit'
  const adding = mode !== 'payment'
  const [original] = useState(()=>editing ? record : null)
  const firstTerm = original?.items[0]
  const monthlyTerms = original && (original.items.length > 1 || original.apr > 0)
  const choices = record?.items.filter(row=>left(row)>0) || []
  const first = choices.find(row=>row.id===item?.id) || choices[0]
  const [form,setForm] = useState(()=>({kind:original?.kind || (direction==='lent'?'lent':'borrowed'),name:original?.name || '',person:original?.person || '',amount:original ? String(original.opening/1000) : '',
    date:dateKey(),due:firstTerm?.due || dateKey(),month:firstTerm?.month || '',frequency:monthlyTerms?'monthly':'once',monthly:firstTerm?String(firstTerm.amount/1000):'',apr:String(original?.apr || 0),note:original?.note || '',reminder:original?.reminder ?? null,item:first?.id || '',transaction:''}))
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
  const fmt = amount => money(amount/1000,currency)
  const extra = !adding && selection && extraPaymentChange(record,selection,rawAmount,currency)
  const extraError = extra?.precisionError ? 'This balance does not match the currency’s precision.' : extra?.limit != null
    ? `Enter ${fmt(extra.limit)} or less for ${monthLabel(selection.month)}${extra.hasLater ? ' and later' : ''}.` : ''
  const monthlyPlan = form.frequency === 'monthly'
  const apr = monthlyPlan && form.kind === 'loan' ? Number(form.apr || 0) : 0
  const monthly = monthlyPlan ? debtAmount(form.monthly,currency) : rawAmount
  const scheduleInput = {opening:rawAmount, monthly, apr, month:form.month||form.due.slice(0,7), due:form.due}
  const sameTerms = original && rawAmount === original.opening && apr === original.apr &&
    form.due === firstTerm.due && scheduleInput.month === firstTerm.month && monthlyPlan === monthlyTerms &&
    (!monthlyPlan || monthly === firstTerm.amount)
  let proposedSchedule
  if (adding && rawAmount > 0 && monthly > 0 && apr >= 0 && apr <= 100 && form.due) {
    try { proposedSchedule = sameTerms ? original.items : makeSchedule(scheduleInput,currency,false) } catch { /* A field-specific error appears on save. */ }
  }
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
    if (busy || previewOnly) return
    setError('')
    if (!(rawAmount>0)) { setError(adding?'Enter a total amount greater than zero.':'Enter a payment greater than zero.'); return }
    try {
      if (adding) {
        if (!form.name.trim() || !form.due) throw new Error('Enter a name and the first due date.')
        if (!(monthly>0)) throw new Error('Enter a monthly payment greater than zero.')
        if (!Number.isFinite(apr) || apr<0 || apr>100) throw new Error('Enter an interest rate from 0% to 100%.')
        if (original && incoming(original) !== (form.kind === 'lent') && original.items.some(term=>term.payments.length)) {
          throw new Error('Recorded payments must keep their original direction.')
        }
        const items = sameTerms ? original.items : preserveDebtPayments(original?.items || [],makeSchedule(scheduleInput,currency))
        await onCreate({id:original?.id || entryId,kind:form.kind,name:form.name.trim(),person:form.person.trim(),opening:rawAmount,apr,items,note:form.note.trim(),reminder:form.reminder})
      } else {
        if (!selection) throw new Error('Choose a month that still has a payment due.')
        if (extraError) throw new Error(extraError)
        if (!form.date || form.date>dateKey()) throw new Error('Choose the date the money moved.')
        await onPayment(record.id,selection.id,{id:entryId,amount:rawAmount,date:form.date,note:form.note.trim(),transaction_id:Number(form.transaction)||null})
      }
    } catch (failure) { setError(failure.message) }
  }
  const heading = editing?'Edit debt':adding?'Add debt':receipt?'Record money received':'Record payment'
  const future = extra?.schedule || []
  return <>
    <Modal open onClose={()=>!busy && onClose()} protectChanges size="small" title={heading} layerClass="debt-entry-layer debt-transaction-layer"
      footer={close=><div className="modal-actions"><button type="button" className="button ghost" disabled={busy} onClick={close}>Cancel</button>
        <button className="button primary" form={formId} type="submit" disabled={busy || previewOnly}>{busy?'Saving…':editing?'Save changes':adding?'Save debt':'Save payment'}</button></div>}>
      <form id={formId} onSubmit={save} className="stack gap-18 transaction-form">
        <fieldset className="debt-entry-fields stack gap-16" disabled={busy}>
          <label className="field"><span>{adding?'Total amount now':'Amount'}</span><span className="amount-input debt-amount-input">
            <span aria-hidden="true">{currency}</span><input aria-label={`${adding?'Total amount now':'Amount'} (${currency})`} inputMode="decimal" autoComplete="off" value={form.amount} onChange={e=>set('amount',e.target.value)} placeholder={currencyPlaceholder(currency)}/>
          </span></label>
          {adding ? <>
            <label className="field"><span>What are you tracking?</span><AppSelect renderOptionIcon={option => <CategoryIcon name={option?.label} size={16}/>} value={form.kind} onChange={e=>set('kind',e.target.value)}>{kinds.map(([value,label])=><option key={value} value={value}>{label}</option>)}</AppSelect></label>
            <label className="field"><span>Name</span><input value={form.name} onChange={e=>set('name',e.target.value)} maxLength={120} placeholder="e.g. Car loan"/></label>
            <div className="debt-form-pair"><DateField label="First due date" value={form.due} onChange={value=>set('due',value)} min="1900-01-01" max="2199-12-31" disabled={busy}/>
              <label className="field"><span>Pay back</span><AppSelect value={form.frequency} onChange={e=>set('frequency',e.target.value)}><option value="once">Once</option><option value="monthly">Every month</option></AppSelect></label></div>
            {monthlyPlan && <label className="field"><span>Monthly payment ({currency})</span><input inputMode="decimal" value={form.monthly} onChange={e=>set('monthly',e.target.value)}/></label>}
          </> : <>
            <div className="debt-entry-context"><div><strong>{record.name}</strong>{selection && <small className="debt-month-due muted">{fmt(left(selection))} left for {monthLabel(selection.month,true)}</small>}</div>
              <InfoButton label="About payment dates" onClick={()=>setHelp(true)}/></div>
            <div className="debt-form-pair"><DateField label={receipt?'Received on':'Paid on'} value={form.date} onChange={value=>set('date',value)} max={dateKey()} min="1900-01-01" disabled={busy}/>
              <label className="field"><span>Applies to</span><AppSelect value={form.item} onChange={e=>set('item',e.target.value)}>{choices.map(row=><option key={row.id} value={row.id}>{monthLabel(row.month,true)}</option>)}</AppSelect></label></div>
            {extra?.extra > 0 && <div className="debt-payment-preview" role="status">
              <strong>{fmt(extra.extra)} extra</strong>
              {!future.length ? <small className="muted">No payments left after {monthLabel(selection.month)}.</small> :
                <><small className="muted">Updated repayments</small>
                <dl className="debt-data">{future.slice(0,3).map(term=><div key={term.month}><dt>{monthLabel(term.month,true)}</dt><dd>{fmt(term.amount)}</dd></div>)}</dl>
                {future.length>3 && <details><summary>Show {future.length-3} more months</summary><dl className="debt-data">{future.slice(3).map(term=><div key={term.month}><dt>{monthLabel(term.month,true)}</dt><dd>{fmt(term.amount)}</dd></div>)}</dl></details>}</>}
            </div>}
          </>}
          {adding&&<div className="debt-form-help"><InfoButton label="About repayment schedules" onClick={()=>setHelp(true)}/></div>}
          <details className="form-options" onToggle={event=>{if (!adding) setSearchLinks(event.currentTarget.open)}}>
            <summary>More options</summary><div className="stack gap-16">
              {adding && <>
                {monthlyPlan && form.kind==='loan' && <label className="field"><span>Annual interest (%)</span><input type="number" min="0" max="100" step="any" value={form.apr} onChange={e=>set('apr',e.target.value)}/><small className="muted">Leave at 0% for an interest-free loan.</small></label>}
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
          {proposedSchedule && <small className="muted" role="status">{proposedSchedule.length===1?'1 payment':`${proposedSchedule.length} monthly payments`} · {fmt(sum(proposedSchedule,item=>item.amount))} total · {apr?`${apr}% interest`:'No interest'}</small>}
          {(error || extraError) && <p className="form-error" role="alert">{error || extraError}</p>}
        </fieldset>
      </form>
    </Modal>
    <Modal open={help} onClose={()=>setHelp(false)} size="small" title={adding?'Repayment schedules':'Payment month and date'}>
      <p>{adding?'Monthly loans use estimated interest to build a schedule. You can set a payment month separately from the due date.':
        'Use the actual date the money moved. Applies to is the month of the instalment this payment covers. Extra payments use the interest already in your schedule. Link a matching Personal transaction to keep one ledger entry.'}</p>
    </Modal>
  </>
}
