import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import OfflinePending from './OfflinePending'
const state = vi.hoisted(() => ({ rows:[], discard:vi.fn(), retry:vi.fn(), flush:vi.fn(), confirm:vi.fn(), notify:vi.fn() }))
vi.mock('../App', () => ({useApp:()=>({user:{id:4},settings:{currency:'KWD'},confirm:state.confirm,notify:state.notify})}))
vi.mock('../lib/api', () => ({money:value=>String(value),flushOfflineTransactions:()=>state.flush()}))
vi.mock('../lib/offlineSync', async importOriginal => ({
  ...await importOriginal(),
  listOfflineQueue:async()=>state.rows,
  discardOfflineTransaction:(...args)=>state.discard(...args),
  retryOfflineTransaction:(...args)=>state.retry(...args),
}))
beforeEach(()=>{
  state.rows=[{id:'a',description:'Coffee',amount:2,path:'/api/transactions?space_id=personal',attempted:false,status:'pending'}]
  state.confirm.mockResolvedValue(true)
  state.discard.mockResolvedValue()
  state.retry.mockResolvedValue()
  state.flush.mockResolvedValue()
})
afterEach(()=>{cleanup();vi.resetAllMocks()})
test('only never-attempted entries offer discard and confirmation makes no server promise',async()=>{
  render(<OfflinePending scope="personal"/>)
  fireEvent.click(await screen.findByRole('button',{name:'Discard Coffee'}))
  await waitFor(()=>expect(state.discard).toHaveBeenCalledWith('a',4))
  expect(state.confirm.mock.calls[0][0]).toContain('only before a save attempt starts')
  expect(state.confirm.mock.calls[0][0]).not.toContain('has not reached')
})
test.each([true,undefined])('attempted or legacy entries explain uncertainty and retain retry (%s)',async attempted=>{
  state.rows[0].attempted=attempted
  render(<OfflinePending scope="personal"/>)
  expect(await screen.findByRole('button',{name:'Discard Coffee'})).toBeDisabled()
  expect(screen.getByText(/may already have reached your wallet/)).toBeVisible()
  expect(screen.getByRole('button',{name:'Retry Coffee'})).toBeEnabled()
  expect(state.confirm).not.toHaveBeenCalled()
})
test('a sync starting during confirmation reports the atomic refusal and retains the entry',async()=>{
  let answer
  state.confirm.mockImplementation(()=>new Promise(resolve=>{answer=resolve}))
  state.discard.mockRejectedValue(new Error('This entry may already have reached your wallet.'))
  render(<OfflinePending scope="personal"/>)
  fireEvent.click(await screen.findByRole('button',{name:'Discard Coffee'}))
  state.rows[0]={...state.rows[0],attempted:true}
  await act(async()=>window.dispatchEvent(new Event('budgetly:offline-queue-changed')))
  await act(async()=>answer(true))
  await waitFor(()=>expect(state.notify).toHaveBeenCalledWith(expect.stringContaining('may already have reached'),'error'))
  expect(screen.getByRole('button',{name:'Discard Coffee'})).toBeDisabled()
})
