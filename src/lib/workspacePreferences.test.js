import { beforeEach, expect, test, vi } from 'vitest'
import { clearEntryMemory, readWorkspacePreferences, recentEntries, rememberEntry, saveWorkspacePreferences, secondaryPages } from './workspacePreferences'
import { duplicateDraft } from './transactionDraft'

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks() })
test('preferences are isolated by account and sanitize corrupt values', () => {
  saveWorkspacePreferences(1,{favoriteWallets:[2,2,-1,'3'],notesView:'list',navOrder:['/notes','/unknown']})
  expect(readWorkspacePreferences(1).favoriteWallets).toEqual([2])
  expect(readWorkspacePreferences(1).notesView).toBe('list')
  expect(readWorkspacePreferences(2).notesView).toBe('grid')
  expect(readWorkspacePreferences(1).navOrder).toHaveLength(secondaryPages.length)
  expect(readWorkspacePreferences(1).navOrder[0]).toBe('/notes')
})
test('entry history never remembers money, dates, recurrence or reporting month', () => {
  rememberEntry(1,'personal',{type:'income',wallet_id:2,category_id:3,description:'Salary',amount:500,date:'2026-10-01',reporting_month:'2026-10',recurring_frequency:'monthly'})
  expect(recentEntries(1,'personal')).toEqual([{type:'income',wallet_id:2,category_id:3,description:'Salary',uses:1}])
  expect(recentEntries(2,'personal')).toEqual([])
  expect(recentEntries(1,'shared')).toEqual([])
  saveWorkspacePreferences(1,{rememberEntry:false})
  expect(recentEntries(1,'personal')).toEqual([])
  rememberEntry(1,'personal',{type:'expense',description:'Test'})
  clearEntryMemory(1)
  saveWorkspacePreferences(1,{rememberEntry:true})
  expect(recentEntries(1,'personal')).toEqual([])
})
test('history is bounded, expires, and tolerates unavailable storage', () => {
  for(let i=0;i<12;i++) rememberEntry(1,'shared',{type:'expense',wallet_id:2,description:`Item ${i}`})
  expect(recentEntries(1,'shared')).toHaveLength(8)
  localStorage.setItem('budgetly:entry:v1:1:shared',JSON.stringify({savedAt:Date.now()-31*86400000,entries:[{type:'expense',description:'Old'}]}))
  expect(recentEntries(1,'shared')).toEqual([])
  vi.spyOn(window.Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('Full')})
  expect(saveWorkspacePreferences(1,{notesView:'list'})).toBe(false)
  expect(()=>rememberEntry(1,'personal',{type:'expense',description:'Still saved online'})).not.toThrow()
})
test('duplicate is a new one-time draft requiring a fresh income month', () => {
  const copied=duplicateDraft({id:4,revision:6,type:'income',amount:30,wallet_id:2,reporting_month:'2026-09',recurring_frequency:'monthly'},'2026-10-01T12:00')
  expect(copied).not.toHaveProperty('id')
  expect(copied).not.toHaveProperty('revision')
  expect(copied.reporting_month).toBe('')
  expect(copied.recurring_frequency).toBe('none')
  expect(copied.date).toBe('2026-10-01T12:00')
})
