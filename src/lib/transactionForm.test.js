import { beforeEach, expect, it, vi } from 'vitest'
import { transactionErrors } from './transactionForm'
import { clearDraft, readDraft, writeDraft } from './transactionDraft'

beforeEach(() => {sessionStorage.clear();localStorage.clear();vi.restoreAllMocks()})
it('validates personal and shared drafts with the same rules', () => {
  const form={amount:'2.25',wallet_id:1,date:'2026-09-23T12:00',type:'expense'}
  expect(transactionErrors(form)).toEqual({})
  expect(transactionErrors({...form,amount:'Infinity'})).toHaveProperty('amount')
  expect(transactionErrors({...form,type:'transfer',transfer_wallet_id:'1'})).toHaveProperty('transfer_wallet_id')
  expect(transactionErrors({...form,recurring_frequency:'monthly',recurring_until:'2026-09-22'})).toHaveProperty('recurring_until')
})
it('recovers a draft after session loss, isolates users, expires and discards it', () => {
  const key='flowbudget_tx_draft_5', draft={amount:'2.25'}
  writeDraft(key,draft);sessionStorage.clear()
  expect(readDraft(key)).toEqual(draft)
  expect(readDraft('flowbudget_tx_draft_6')).toBeNull()
  clearDraft(key);expect(readDraft(key)).toBeNull()
  writeDraft(key,draft);sessionStorage.clear()
  vi.spyOn(Date,'now').mockReturnValue(Date.now()+8*86400000)
  expect(readDraft(key)).toBeNull()
})
