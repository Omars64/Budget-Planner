import { expect, test } from 'vitest'
import { debtAmount, makeSchedule, paymentStatus, payoffMonth } from './debtWorkspace'

test('keeps the payment month distinct from a month-end due date',()=>{
  const items = makeSchedule({opening:30000,monthly:10000,apr:0,month:'2027-01',due:'2027-02-28'},'KWD')
  expect(items.map(item=>[item.month,item.due])).toEqual([['2027-01','2027-02-28'],['2027-02','2027-03-28'],['2027-03','2027-04-28']])
  const monthEnd = makeSchedule({opening:30000,monthly:10000,apr:0,month:'2027-01',due:'2027-01-31'},'KWD')
  expect(monthEnd.map(item=>item.due)).toEqual(['2027-01-31','2027-02-28','2027-03-31'])
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
