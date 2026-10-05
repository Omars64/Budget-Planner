import { beforeEach, afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { weeklySummary } from './weeklySummary'
import { frequentPages, recordPageVisit, readPageUsage } from './pageUsage'
import { saveWorkspacePreferences } from './workspacePreferences'
import { celebrateMilestone } from '../components/Milestone'
import WeeklySummary from '../components/WeeklySummary'

beforeEach(() => localStorage.clear())
afterEach(() => { cleanup(); vi.restoreAllMocks() })
test('weekly summary uses Kuwait dates, excludes transfers/openings and separates prior week', () => {
  const rows = [
    {date:'2026-10-05T12:00',type:'income',amount:50},
    {date:'2026-09-29T10:00',type:'expense',amount:12,category_id:1,category_name:'Food'},
    {date:'2026-09-28T12:00',type:'expense',amount:8},
    {date:'2026-10-05T13:00',type:'transfer',amount:200},
    {date:'2026-10-05T13:00',type:'income',amount:999,is_opening_balance:true},
    {date:'2026-10-06T13:00',type:'expense',amount:999},
  ]
  expect(weeklySummary(rows,new Date('2026-10-04T22:00Z'))).toEqual({start:'2026-09-29',end:'2026-10-05',income:50,expense:12,previous_expense:8,count:2,top_category:{id:1,name:'Food',amount:12}})
})
test('shortcuts are bounded, isolated, opt-out aware and filter guest restrictions', () => {
  recordPageVisit(1,'/notes'); recordPageVisit(1,'/notes')
  recordPageVisit(1,'/wallets'); recordPageVisit(1,'/admin')
  recordPageVisit(1,'/analytics',false)
  expect(frequentPages(1)[0][0]).toBe('/notes')
  expect(readPageUsage(2)['/notes']).toBe(0)
  expect(readPageUsage(1)['/analytics']).toBe(0)
  expect(frequentPages(1,new Set(['/wallets','/budgets']))).toEqual([['/wallets','Wallets'],['/budgets','Budgets']])
  localStorage.setItem('budgetly:page-usage:v1:1',JSON.stringify({'/notes':Infinity,'/wallets':-2}))
  expect(readPageUsage(1)['/wallets']).toBe(0)
})
test('celebrations honor opt-out and announce each milestone only once', () => {
  const listener=vi.fn(); window.addEventListener('budgetly:milestone',listener)
  saveWorkspacePreferences(1,{goalCelebrations:false})
  celebrateMilestone('1:goal:2:25','25% of your goal','Savings',1)
  expect(listener).not.toHaveBeenCalled()
  saveWorkspacePreferences(1,{goalCelebrations:true})
  celebrateMilestone('1:goal:2:25','25% of your goal','Savings',1)
  celebrateMilestone('1:goal:2:25','25% of your goal','Savings',1)
  expect(listener).toHaveBeenCalledTimes(1)
  window.removeEventListener('budgetly:milestone',listener)
})
test('weekly actions open exact date range rather than selected reporting month', () => {
  render(<MemoryRouter><WeeklySummary value={{start:'2026-09-29',end:'2026-10-05',income:10,expense:8,previous_expense:6,count:2,top_category:{id:3,name:'Food'}}} fmt={String}/></MemoryRouter>)
  fireEvent.click(screen.getByText('Last 7 days'))
  expect(screen.getByText('2 more spent than the previous 7 days.')).toBeInTheDocument()
  expect(screen.getByRole('link',{name:'Review Food'})).toHaveAttribute('href','/transactions')
})
