import { expect, test } from 'vitest'
import { debtAmount, extraPaymentChange, makeSchedule, paymentStatus, payoffMonth, preserveDebtPayments } from './debtWorkspace'

test('keeps the payment month distinct from a month-end due date',()=>{
  const items = makeSchedule({opening:30000,monthly:10000,apr:0,month:'2027-01',due:'2027-02-28'},'KWD')
  expect(items.map(item=>[item.month,item.due])).toEqual([['2027-01','2027-02-28'],['2027-02','2027-03-28'],['2027-03','2027-04-28']])
  const monthEnd = makeSchedule({opening:30000,monthly:10000,apr:0,month:'2027-01',due:'2027-01-31'},'KWD')
  expect(monthEnd.map(item=>item.due)).toEqual(['2027-01-31','2027-02-28','2027-03-31'])
})

test('previews extra payments using only later unpaid months and exact currency precision',()=>{
  const items = makeSchedule({opening:36000,monthly:12000,apr:0,month:'2026-12',due:'2026-12-01'},'KWD')
  const record = {kind:'loan',items}
  expect(extraPaymentChange(record,items[0],15000,'KWD')).toEqual({extra:3000,amounts:[10500,10500]})
  expect(extraPaymentChange(record,items[0],15001,'KWD')).toEqual({extra:3001,amounts:[10500,10499]})
  expect(extraPaymentChange(record,items[0],15010,'USD')).toEqual({extra:3010,amounts:[10500,10490]})
  expect(extraPaymentChange(record,items[1],25000,'KWD')).toEqual({limit:24000,hasLater:true})
  expect(extraPaymentChange(record,items[0],36000,'KWD')).toEqual({extra:24000,amounts:[]})
})

test('uses only outgoing debt in payoff estimates and tracks partial receipts',()=>{
  const outgoing = {kind:'loan',apr:0,items:makeSchedule({opening:30000,monthly:10000,apr:0,month:'2027-01',due:'2027-01-31'},'KWD')}
  const receipt = {kind:'lent',items:[{amount:17000,due:'2027-01-31',month:'2027-01',payments:[{amount:4000,date:'2027-02-05'}]}]}
  expect(paymentStatus(receipt,receipt.items[0],'2027-02-06')).toBe('Part received · Overdue')
  expect(payoffMonth([outgoing,receipt],0,'2027-01-01')).toBe('2027-03')
  expect(payoffMonth([outgoing,receipt],10000,'2027-01-01')).toBe('2027-02')
  expect(debtAmount('1.025','KWD')).toBe(1025)
  expect(debtAmount('1.025','USD')).toBeNaN()
})

test('editing repayment terms keeps recorded payments attached to their original month',()=>{
  const terms = {opening:30000,monthly:10000,apr:0,month:'2027-01',due:'2027-01-09'}
  const old = makeSchedule(terms,'KWD')
  old[0].payments.push({id:'payment',amount:8000,transaction_id:14})
  const build = values => makeSchedule({...terms,...values},'KWD')
  const revised = preserveDebtPayments(old,build({monthly:15000}))
  expect(revised[0]).toMatchObject({id:old[0].id,amount:15000,payments:old[0].payments})
  expect(()=>preserveDebtPayments(old,build({monthly:7000}))).toThrow(/recorded payments/)
  expect(()=>preserveDebtPayments(old,build({month:'2027-02'}))).toThrow(/January/)
})
