import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import TransactionModal from './TransactionModal'
import { api } from '../lib/api'

vi.mock('../App', () => ({useApp:() => ({user:{id:9},settings:{currency:'KWD'}})}))
vi.mock('../lib/api', () => ({api:vi.fn(),jsonBody:data=>({body:JSON.stringify(data)}),money:n=>'KWD '+Number(n||0).toFixed(3)}))
afterEach(cleanup)
beforeAll(() => {
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
  window.HTMLDialogElement.prototype.close = function () { this.open = false }
})
beforeEach(() => {
  sessionStorage.clear(); localStorage.clear(); vi.clearAllMocks()
  sessionStorage.setItem('flowbudget_tx_draft_9', JSON.stringify({ type:'expense', amount:'', description:'', notes:'', date:'2026-09-12T12:00', wallet_id:1, transfer_wallet_id:'', category_id:'', recurring_frequency:'none', recurring_until:'' }))
  api.mockImplementation(path => Promise.resolve(path==='/api/wallets' ? [{id:1,name:'Main Wallet',balance:50}] : path==='/api/categories' ? [{id:2,name:'Food',kind:'expense'}] : {}))
})
async function mount() {
  render(<TransactionModal open onClose={vi.fn()} onSaved={vi.fn()}/> )
  await waitFor(() => expect(screen.getByRole('button',{name:'Add transaction'})).toBeEnabled())
}
it('keeps templates collapsed and explains invalid amounts', async () => {
  await mount()
  expect(screen.getByText('Templates').closest('details')).not.toHaveAttribute('open')
  expect(screen.getByLabelText('Description').closest('details')).toBeNull()
  expect(api).not.toHaveBeenCalledWith('/api/transaction-templates')
  fireEvent.click(screen.getByRole('button',{name:'Add transaction'}))
  expect(screen.getByRole('alert')).toHaveTextContent('amount greater than zero')
})
it.each(['daily','weekly','monthly','yearly'])('requires a valid end date for %s schedules', async frequency => {
  await mount()
  fireEvent.change(screen.getByLabelText('Amount (KWD)'),{target:{value:'1'}})
  fireEvent.click(screen.getByText('More options'))
  fireEvent.change(screen.getByLabelText('Repeat'),{target:{value:frequency}})
  fireEvent.click(screen.getByRole('button',{name:'Add transaction'}))
  expect(screen.getByRole('alert')).toHaveTextContent('repeat-until date')
  fireEvent.change(screen.getByLabelText('Repeat until'),{target:{value:'2026-09-11'}})
  fireEvent.click(screen.getByRole('button',{name:'Add transaction'}))
  expect(screen.getByRole('alert')).toHaveTextContent('on or after')
  fireEvent.change(screen.getByLabelText('Repeat until'),{target:{value:'2026-10-12'}})
  fireEvent.click(screen.getByRole('button',{name:'Add transaction'}))
  await waitFor(() => expect(api).toHaveBeenCalledWith('/api/transactions',expect.objectContaining({method:'POST'})))
  const payload=JSON.parse(api.mock.calls.find(([path])=>path==='/api/transactions')[1].body)
  expect(payload.recurring_until).toBe('2026-10-12')
  expect(payload.recurring_frequency).toBe(frequency)
})
it('saves the calendar and clock selection as UTC and retains an edited time', async () => {
  render(<TransactionModal open editing={{id:10,type:'expense',amount:2,description:'Lunch',notes:'',date:'2026-09-12T09:00:00Z',wallet_id:1,category_id:2,recurring_frequency:'none'}} onClose={vi.fn()} onSaved={vi.fn()}/> )
  await waitFor(() => expect(screen.getByRole('button',{name:'Save changes'})).toBeEnabled())
  expect(screen.getByRole('button',{name:'Time',exact:true})).toHaveTextContent('12:00 PM')
  fireEvent.click(screen.getByRole('button',{name:'Date',exact:true}))
  fireEvent.click(screen.getByRole('button',{name:'Monday, 14 September 2026'}))
  fireEvent.click(screen.getByRole('button',{name:'Set date'}))
  fireEvent.click(screen.getByRole('button',{name:'Time',exact:true}))
  fireEvent.click(screen.getByRole('button',{name:'Type time instead'}))
  fireEvent.change(screen.getByLabelText('Hour'),{target:{value:'12'}})
  fireEvent.change(screen.getByLabelText('Minute'),{target:{value:'05'}})
  fireEvent.click(screen.getByRole('button',{name:'AM',exact:true}))
  fireEvent.click(screen.getByRole('button',{name:'Set time'}))
  fireEvent.click(screen.getByRole('button',{name:'Save changes'}))
  await waitFor(() => expect(api).toHaveBeenCalledWith('/api/transactions/10',expect.objectContaining({method:'PUT'})))
  const payload=JSON.parse(api.mock.calls.find(([path])=>path==='/api/transactions/10')[1].body)
  expect(payload.date).toBe('2026-09-13T21:05:00.000Z')
})
it('submits only once while saving, even after repeated clicks', async () => {
  await mount()
  api.mockImplementation(() => new Promise(() => {}))
  fireEvent.change(screen.getByLabelText('Amount (KWD)'),{target:{value:'1'}})
  const save=screen.getByRole('button',{name:'Add transaction'})
  fireEvent.click(save);fireEvent.click(save);fireEvent.click(save)
  expect(api.mock.calls.filter(([path])=>path==='/api/transactions')).toHaveLength(1)
  expect(screen.getByRole('button',{name:'Saving…'})).toBeDisabled()
})
